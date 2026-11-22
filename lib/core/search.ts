import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  artists,
  entries,
  entryArtists,
  highlightTags,
  highlights,
  tags,
  users,
  type Db,
  type DbOrTx,
} from "../db";
import { listEntries, type EntryFilters, type EntryView } from "./browse";
import { getVectorIndex, type VectorDoc, type VectorHit, type VectorIndex } from "../search";

/** The text embedded for a highlight (docs/architecture.md, Search sync). */
export function vectorText(title: string, artistNames: string[], note: string | null, tagNames: string[]): string {
  return `${title} — ${artistNames.join(", ")}. ${note ?? ""}. Tags: ${tagNames.join(", ")}`;
}

const BATCH = 200;

export type SyncResult = { upserted: number; removed: number };

/**
 * Pushes every dirty highlight (one user's, or all when `userId` is omitted) to the index and clears
 * the flag. A highlight that is deleted, or whose entry is deleted, has its vector removed instead.
 * If the index call throws, the flags stay set and the error propagates.
 */
export async function syncDirtyHighlights(
  db: DbOrTx,
  index: VectorIndex,
  userId?: string,
  limit = BATCH,
): Promise<SyncResult> {
  const rows = await db
    .select({ h: highlights, e: entries })
    .from(highlights)
    .innerJoin(entries, and(eq(entries.id, highlights.entryId), eq(entries.userId, highlights.userId)))
    .where(userId ? and(eq(highlights.searchDirty, true), eq(highlights.userId, userId)) : eq(highlights.searchDirty, true))
    .orderBy(asc(highlights.id))
    .limit(limit);
  if (rows.length === 0) return { upserted: 0, removed: 0 };

  const dead = rows.filter((r) => r.h.deletedAt || r.e.deletedAt).map((r) => r.h.id);
  const live = rows.filter((r) => !r.h.deletedAt && !r.e.deletedAt);

  const docs: VectorDoc[] = [];
  if (live.length) {
    const entryIds = [...new Set(live.map((r) => r.e.id))];
    const hlIds = live.map((r) => r.h.id);
    const [artistRows, tagRows] = await Promise.all([
      db
        .select({ entryId: entryArtists.entryId, name: artists.name })
        .from(entryArtists)
        .innerJoin(artists, eq(artists.id, entryArtists.artistId))
        .where(inArray(entryArtists.entryId, entryIds))
        .orderBy(asc(entryArtists.position)),
      db
        .select({ highlightId: highlightTags.highlightId, name: tags.name })
        .from(highlightTags)
        .innerJoin(tags, eq(tags.id, highlightTags.tagId))
        .where(
          and(inArray(highlightTags.highlightId, hlIds), or(eq(tags.state, "approved"), eq(tags.state, "proposed"))),
        )
        .orderBy(asc(highlightTags.addedAt)),
    ]);
    for (const { h, e } of live) {
      docs.push({
        id: h.id,
        text: vectorText(
          e.title,
          artistRows.filter((a) => a.entryId === e.id).map((a) => a.name),
          h.note,
          tagRows.filter((t) => t.highlightId === h.id).map((t) => t.name),
        ),
        metadata: { user_id: h.userId, entry_id: e.id, status: h.status, captured_at: h.capturedAt.toISOString() },
      });
    }
  }

  if (dead.length) await index.remove(dead);
  if (docs.length) await index.upsert(docs);
  // Not guarded against an edit that lands between the read and this write; the daily re-sync
  // cannot see that either, so a highlight edited in that instant is fixed by its next edit.
  await db
    .update(highlights)
    .set({ searchDirty: false })
    .where(inArray(highlights.id, rows.map((r) => r.h.id)));
  return { upserted: docs.length, removed: dead.length };
}

/** Best-effort sync after a write: never throws, does nothing without an index. The flag stays set on failure. */
export async function syncSearchQuietly(
  db: DbOrTx,
  userId: string,
  index: VectorIndex | null = getVectorIndex(),
): Promise<void> {
  if (!index) return;
  try {
    await syncDirtyHighlights(db, index, userId);
  } catch (e) {
    console.error("Search sync failed; highlights stay dirty until the next re-sync", e);
  }
}

/** Removes vectors by highlight id (used for the highlights the 30-day purge hard-deletes). */
export async function deleteVectors(index: VectorIndex | null, ids: string[]): Promise<void> {
  if (!index || ids.length === 0) return;
  await index.remove(ids);
}

export type ResyncResult = SyncResult & { orphans: number };

/**
 * Upserts every dirty highlight, then removes vectors whose highlight no longer exists live.
 * One user's, or everyone's when `userId` is omitted. The index can always be rebuilt from Postgres.
 */
export async function resyncSearch(db: Db, index: VectorIndex, userId?: string): Promise<ResyncResult> {
  let upserted = 0;
  let removed = 0;
  for (let i = 0; i < 1000; i++) {
    const r = await syncDirtyHighlights(db, index, userId);
    upserted += r.upserted;
    removed += r.removed;
    if (r.upserted + r.removed === 0) break;
  }
  const liveRows = await db
    .select({ id: highlights.id })
    .from(highlights)
    .innerJoin(entries, and(eq(entries.id, highlights.entryId), eq(entries.userId, highlights.userId)))
    .where(
      and(isNull(highlights.deletedAt), isNull(entries.deletedAt), userId ? eq(highlights.userId, userId) : undefined),
    );
  const live = new Set(liveRows.map((r) => r.id));
  const stray = (await index.listAll())
    .filter((v) => (userId ? v.userId === userId : true) && !live.has(v.id))
    .map((v) => v.id);
  if (stray.length) await index.remove(stray);
  return { upserted, removed, orphans: stray.length };
}

/** Re-sync for every user, for the daily cron. */
export async function resyncAllUsers(db: Db, index: VectorIndex): Promise<ResyncResult & { users: number }> {
  const all = await db.select({ id: users.id }).from(users);
  const r = await resyncSearch(db, index);
  return { ...r, users: all.length };
}

/** Highlight ids for a text query, best match first, scoped to the user. Throws when the index fails. */
export async function meaningRank(index: VectorIndex, userId: string, query: string, topK = 50): Promise<VectorHit[]> {
  return index.query(query.trim(), userId, topK);
}

/**
 * Live entries holding the highlights that best match `query` by meaning, best first, with the
 * other entry filters applied. Throws when the index fails (the page decides what to tell the user).
 */
export async function listEntriesByMeaning(
  db: DbOrTx,
  index: VectorIndex,
  userId: string,
  query: string,
  filters: Omit<EntryFilters, "q" | "entryIds"> = {},
): Promise<EntryView[]> {
  const ranked = await meaningRank(index, userId, query);
  if (ranked.length === 0) return [];
  const rows = await db
    .select({ id: highlights.id, entryId: highlights.entryId })
    .from(highlights)
    .where(and(inArray(highlights.id, ranked.map((r) => r.id)), eq(highlights.userId, userId), isNull(highlights.deletedAt)));
  const entryOf = new Map(rows.map((r) => [r.id, r.entryId]));
  const order: string[] = [];
  for (const r of ranked) {
    const e = entryOf.get(r.id);
    if (e && !order.includes(e)) order.push(e);
  }
  if (order.length === 0) return [];
  const views = await listEntries(db, userId, { ...filters, entryIds: order, limit: 200 });
  return views.sort((a, b) => order.indexOf(a.entry.id) - order.indexOf(b.entry.id));
}
