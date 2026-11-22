import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
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
/** How many vector matches are fetched before the other filters narrow them. */
export const MEANING_TOP_K = 100;

export type SyncResult = { upserted: number; removed: number };

/**
 * Pushes every dirty highlight (one user's, or all when `userId` is omitted) to the index and clears
 * the flag. A highlight that is deleted, or whose entry is deleted, has its vector removed instead.
 * If the index call throws, the flags stay set and the error propagates.
 *
 * Must be called outside a transaction: it opens its own, and the advisory lock plus row locks it
 * takes are only released when that transaction commits. Rows another transaction (an edit) holds
 * are skipped (`FOR UPDATE SKIP LOCKED`); the edit re-flags them, so the next sync picks them up.
 */
export async function syncDirtyHighlights(
  db: DbOrTx,
  index: VectorIndex,
  userId?: string,
  limit = BATCH,
): Promise<SyncResult> {
  // One transaction: an advisory lock serializes a user's syncs, the claim (flag cleared) holds the
  // row locks until commit, and any failure rolls the flag back to true. An edit that lands after
  // the claim waits for the commit, then sets the flag again, so it is never lost.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId ?? "*"}))`);
    const dirtyWhere = userId ? and(eq(highlights.searchDirty, true), eq(highlights.userId, userId)) : eq(highlights.searchDirty, true);
    // Lock the batch first, skipping rows an edit holds. A separate select (not a subquery inside
    // the UPDATE) keeps LIMIT exact: Postgres may re-run a locking subquery per updated row.
    const locked = await tx
      .select({ id: highlights.id })
      .from(highlights)
      .where(dirtyWhere)
      .orderBy(asc(highlights.id))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (locked.length === 0) return { upserted: 0, removed: 0 };
    const claimed = await tx
      .update(highlights)
      .set({ searchDirty: false })
      .where(
        and(
          inArray(highlights.id, locked.map((r) => r.id)),
          userId ? eq(highlights.userId, userId) : undefined,
        ),
      )
      .returning({ id: highlights.id });
    if (claimed.length === 0) return { upserted: 0, removed: 0 };
    return pushClaimed(tx, index, claimed.map((c) => c.id), userId);
  });
}

async function pushClaimed(db: DbOrTx, index: VectorIndex, ids: string[], userId?: string): Promise<SyncResult> {
  const rows = await db
    .select({ h: highlights, e: entries })
    .from(highlights)
    .innerJoin(entries, and(eq(entries.id, highlights.entryId), eq(entries.userId, highlights.userId)))
    .where(and(inArray(highlights.id, ids), userId ? eq(highlights.userId, userId) : undefined))
    .orderBy(asc(highlights.id));

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
 * One user's only: every lock it takes is that user's advisory lock, the same one that user's syncs
 * syncs take, so the sweep excludes them. `resyncAllUsers` runs this per user.
 * The index can always be rebuilt from Postgres.
 */
export async function resyncSearch(db: Db, index: VectorIndex, userId: string): Promise<ResyncResult> {
  let upserted = 0;
  let removed = 0;
  // List the index BEFORE reading live rows: a highlight synced after this point is not in `listed`,
  // so it can never be swept as an orphan.
  const listed = await index.listAll();
  const liveRows = await db
    .select({ id: highlights.id, userId: highlights.userId })
    .from(highlights)
    .innerJoin(entries, and(eq(entries.id, highlights.entryId), eq(entries.userId, highlights.userId)))
    .where(
      and(isNull(highlights.deletedAt), isNull(entries.deletedAt), userId ? eq(highlights.userId, userId) : undefined),
    );
  const live = new Set(liveRows.map((r) => r.id));
  // Live highlights the index lacks (lost writes, a wiped index) are marked dirty so the loop pushes them.
  const inIndex = new Set(listed.map((v) => v.id));
  const missingByUser = new Map<string, string[]>();
  for (const r of liveRows) {
    if (inIndex.has(r.id)) continue;
    missingByUser.set(r.userId, [...(missingByUser.get(r.userId) ?? []), r.id]);
  }
  for (const [uid, missing] of missingByUser) {
    for (let i = 0; i < missing.length; i += 500) {
      await db
        .update(highlights)
        .set({ searchDirty: true })
        .where(and(inArray(highlights.id, missing.slice(i, i + 500)), eq(highlights.userId, uid)));
    }
  }
  for (let i = 0; i < 1000; i++) {
    const r = await syncDirtyHighlights(db, index, userId);
    upserted += r.upserted;
    removed += r.removed;
    if (r.upserted + r.removed === 0) break;
  }
  const stray = listed
    .filter((v) => (userId ? v.userId === userId : true) && !live.has(v.id))
    .map((v) => v.id);
  let orphans = 0;
  if (stray.length) {
    // A stray may have been restored since `live` was read. Under the same advisory lock the syncs
    // take, re-check which are live now and remove only the rest. A restore that lands after this
    // check flags the row dirty, so the next sync re-adds it.
    orphans = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
      const nowLive = new Set<string>();
      for (let i = 0; i < stray.length; i += 500) {
        const rows = await tx
          .select({ id: highlights.id })
          .from(highlights)
          .innerJoin(entries, and(eq(entries.id, highlights.entryId), eq(entries.userId, highlights.userId)))
          .where(
            and(
              inArray(highlights.id, stray.slice(i, i + 500)),
              isNull(highlights.deletedAt),
              isNull(entries.deletedAt),
              userId ? eq(highlights.userId, userId) : undefined,
            ),
          );
        for (const r of rows) nowLive.add(r.id);
      }
      const toRemove = stray.filter((id) => !nowLive.has(id));
      if (toRemove.length) await index.remove(toRemove);
      return toRemove.length;
    });
  }
  return { upserted, removed, orphans };
}

/** Re-sync for every user, for the daily cron. */
export async function resyncAllUsers(db: Db, index: VectorIndex): Promise<ResyncResult & { users: number }> {
  const all = await db.select({ id: users.id }).from(users).orderBy(asc(users.id));
  const total: ResyncResult = { upserted: 0, removed: 0, orphans: 0 };
  // Per user, so every sweep takes that user's own advisory lock (the one their syncs take).
  for (const u of all) {
    const r = await resyncSearch(db, index, u.id);
    total.upserted += r.upserted;
    total.removed += r.removed;
    total.orphans += r.orphans;
  }
  // Vectors owned by nobody we know (no owner metadata, or a user row that no longer exists). A
  // highlight with a live row belongs to a listed user, so these are removed unless still live.
  const known = new Set(all.map((u) => u.id));
  const unowned = (await index.listAll()).filter((v) => !v.userId || !known.has(v.userId)).map((v) => v.id);
  if (unowned.length) {
    const liveIds = new Set<string>();
    for (let i = 0; i < unowned.length; i += 500) {
      const rows = await db
        .select({ id: highlights.id })
        .from(highlights)
        .innerJoin(entries, and(eq(entries.id, highlights.entryId), eq(entries.userId, highlights.userId)))
        .where(and(inArray(highlights.id, unowned.slice(i, i + 500)), isNull(highlights.deletedAt), isNull(entries.deletedAt)));
      for (const r of rows) liveIds.add(r.id);
    }
    const toRemove = unowned.filter((id) => !liveIds.has(id));
    if (toRemove.length) await index.remove(toRemove);
    total.orphans += toRemove.length;
  }
  return { ...total, users: all.length };
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
  const ranked = await meaningRank(index, userId, query, MEANING_TOP_K);
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
