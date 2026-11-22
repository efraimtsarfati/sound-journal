import { and, asc, count, desc, eq, exists, ilike, inArray, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm";
import {
  artists,
  entries,
  entryArtists,
  entrySources,
  highlightTags,
  highlights,
  tags,
  type DbOrTx,
  type Entry,
  type EntrySource,
  type Highlight,
  type Tag,
} from "../db";

export type HighlightTag = Pick<Tag, "id" | "axis" | "name" | "state">;
export type HighlightView = Highlight & { tags: HighlightTag[] };
export type EntryView = {
  entry: Entry;
  artists: string[];
  source: EntrySource | null;
  highlights: HighlightView[];
};

/** Loads artists, the first source and live highlights (with their live tags) for the given entries. */
async function assemble(db: DbOrTx, userId: string, rows: Entry[], opts: { deleted?: boolean } = {}): Promise<EntryView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((e) => e.id);
  const [artistRows, sourceRows, hlRows] = await Promise.all([
    db
      .select({ entryId: entryArtists.entryId, name: artists.name })
      .from(entryArtists)
      .innerJoin(artists, eq(artists.id, entryArtists.artistId))
      .where(inArray(entryArtists.entryId, ids))
      .orderBy(asc(entryArtists.position)),
    db.select().from(entrySources).where(inArray(entrySources.entryId, ids)).orderBy(asc(entrySources.addedAt)),
    db
      .select()
      .from(highlights)
      .where(
        and(
          inArray(highlights.entryId, ids),
          eq(highlights.userId, userId),
          // A deleted entry shows the highlights deleted along with it; a live one shows its live ones.
          opts.deleted ? isNotNull(highlights.deletedAt) : isNull(highlights.deletedAt),
        ),
      )
      .orderBy(asc(highlights.startSec), asc(highlights.createdAt)),
  ]);
  const hlIds = hlRows.map((h) => h.id);
  const tagRows = hlIds.length
    ? await db
        .select({
          highlightId: highlightTags.highlightId,
          id: tags.id,
          axis: tags.axis,
          name: tags.name,
          state: tags.state,
        })
        .from(highlightTags)
        .innerJoin(tags, and(eq(tags.id, highlightTags.tagId), eq(tags.userId, userId)))
        .where(inArray(highlightTags.highlightId, hlIds))
        .orderBy(asc(highlightTags.addedAt))
    : [];
  return rows.map((entry) => ({
    entry,
    artists: artistRows.filter((a) => a.entryId === entry.id).map((a) => a.name),
    source: sourceRows.find((s) => s.entryId === entry.id) ?? null,
    highlights: hlRows
      // For a deleted entry, only the highlights deleted with it (same deletion time) come back on restore.
      .filter((h) => h.entryId === entry.id && (!opts.deleted || h.deletedAt?.getTime() === entry.deletedAt?.getTime()))
      .map((h) => ({
        ...h,
        tags: tagRows
          .filter((t) => t.highlightId === h.id && t.state !== "rejected" && t.state !== "merged")
          .map(({ id, axis, name, state }) => ({ id, axis, name, state })),
      })),
  }));
}

export type EntryFilters = {
  /** Text search over title, album and artist names. */
  q?: string;
  /** Artist name (partial, case-insensitive). */
  artist?: string;
  /** Tag name (exact, case-insensitive) on a live highlight. */
  tag?: string;
  /** Tag axis on a live highlight. */
  axis?: string;
  /** Highlight workflow status. */
  status?: "needs_why" | "needs_tags" | "tagged";
};

const likeOf = (s: string) => `%${s.replace(/[\%_]/g, "\$&")}%`;

/** Live entries, newest first, with their live highlights, tags and status. Filters combine with AND. */
export async function listEntries(
  db: DbOrTx,
  userId: string,
  opts: { limit?: number; offset?: number } & EntryFilters = {},
): Promise<EntryView[]> {
  const conds = [eq(entries.userId, userId), isNull(entries.deletedAt)];
  const artistMatch = (text: string) =>
    exists(
      db
        .select({ one: sql`1` })
        .from(entryArtists)
        .innerJoin(artists, eq(artists.id, entryArtists.artistId))
        .where(and(eq(entryArtists.entryId, entries.id), ilike(artists.name, likeOf(text)))),
    );
  const q = opts.q?.trim();
  if (q) {
    conds.push(or(ilike(entries.title, likeOf(q)), ilike(entries.album, likeOf(q)), artistMatch(q))!);
  }
  const artist = opts.artist?.trim();
  if (artist) conds.push(artistMatch(artist));
  const tag = opts.tag?.trim();
  if (opts.status || tag || opts.axis) {
    const hl = [eq(highlights.entryId, entries.id), eq(highlights.userId, userId), isNull(highlights.deletedAt)];
    if (opts.status) hl.push(eq(highlights.status, opts.status));
    if (tag || opts.axis) {
      const t = [
        eq(highlightTags.highlightId, highlights.id),
        eq(tags.userId, userId),
        notInArray(tags.state, ["rejected", "merged"]),
      ];
      if (tag) t.push(ilike(tags.name, tag.replace(/[\%_]/g, "\$&")));
      if (opts.axis) t.push(eq(tags.axis, opts.axis));
      hl.push(
        exists(
          db
            .select({ one: sql`1` })
            .from(highlightTags)
            .innerJoin(tags, eq(tags.id, highlightTags.tagId))
            .where(and(...t)),
        ),
      );
    }
    conds.push(exists(db.select({ one: sql`1` }).from(highlights).where(and(...hl))));
  }
  const rows = await db
    .select()
    .from(entries)
    .where(and(...conds))
    .orderBy(desc(entries.createdAt), desc(entries.id))
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200))
    .offset(Math.max(opts.offset ?? 0, 0));
  return assemble(db, userId, rows);
}

/** One live entry with its live highlights, or null. */
export async function getEntry(db: DbOrTx, userId: string, entryId: string): Promise<EntryView | null> {
  const [row] = await db
    .select()
    .from(entries)
    .where(and(eq(entries.id, entryId), eq(entries.userId, userId), isNull(entries.deletedAt)));
  return row ? (await assemble(db, userId, [row]))[0] : null;
}

/** Soft-deleted entries (not yet purged), most recently deleted first, with the highlights deleted along with them. */
export async function listDeletedEntries(db: DbOrTx, userId: string): Promise<EntryView[]> {
  const rows = await db
    .select()
    .from(entries)
    .where(and(eq(entries.userId, userId), isNotNull(entries.deletedAt)))
    .orderBy(desc(entries.deletedAt));
  return assemble(db, userId, rows, { deleted: true });
}

export type InboxCounts = { needsWhy: number; needsTags: number };

/** Highlights waiting on a note or on tags (live highlights on live entries). */
export async function inboxCounts(db: DbOrTx, userId: string): Promise<InboxCounts> {
  const rows = await db
    .select({ status: highlights.status, n: count() })
    .from(highlights)
    .innerJoin(entries, and(eq(entries.id, highlights.entryId), eq(entries.userId, highlights.userId)))
    .where(and(eq(highlights.userId, userId), isNull(highlights.deletedAt), isNull(entries.deletedAt)))
    .groupBy(highlights.status);
  const get = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
  return { needsWhy: get("needs_why"), needsTags: get("needs_tags") };
}

export type ProposedTag = Tag & { uses: number };

/** Tags the agent proposed that the owner hasn't decided on yet, oldest first, with how many highlights carry each. */
export async function listProposedTags(db: DbOrTx, userId: string): Promise<ProposedTag[]> {
  const rows = await db
    .select({ tag: tags, uses: count(highlightTags.highlightId) })
    .from(tags)
    .leftJoin(highlightTags, eq(highlightTags.tagId, tags.id))
    .where(and(eq(tags.userId, userId), eq(tags.state, "proposed")))
    .groupBy(tags.id)
    .orderBy(asc(tags.createdAt));
  return rows.map((r) => ({ ...r.tag, uses: r.uses }));
}

/** Approved tags, for choosing a merge target. */
export async function listApprovedTags(db: DbOrTx, userId: string): Promise<Tag[]> {
  return db
    .select()
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.state, "approved")))
    .orderBy(asc(tags.axis), asc(tags.name));
}

/** Everything the user owns, as JSON-ready rows. Auth tables are excluded (docs/data-model.md, Export). */
export async function exportAll(db: DbOrTx, userId: string) {
  const entryRows = await db.select().from(entries).where(eq(entries.userId, userId));
  const ids = entryRows.map((e) => e.id);
  const [sources, links, highlightRows, tagRows, highlightTagRows] = await Promise.all([
    ids.length ? db.select().from(entrySources).where(inArray(entrySources.entryId, ids)) : [],
    ids.length ? db.select().from(entryArtists).where(inArray(entryArtists.entryId, ids)) : [],
    db.select().from(highlights).where(eq(highlights.userId, userId)),
    db.select().from(tags).where(eq(tags.userId, userId)),
    db
      .select({ ht: highlightTags })
      .from(highlightTags)
      .innerJoin(highlights, eq(highlights.id, highlightTags.highlightId))
      .where(eq(highlights.userId, userId))
      .then((r) => r.map((x) => x.ht)),
  ]);
  const artistIds = [...new Set(links.map((l) => l.artistId))];
  const artistRows = artistIds.length ? await db.select().from(artists).where(inArray(artists.id, artistIds)) : [];
  return {
    exportedAt: new Date().toISOString(),
    entries: entryRows,
    entry_sources: sources,
    artists: artistRows,
    entry_artists: links,
    highlights: highlightRows,
    tags: tagRows,
    highlight_tags: highlightTagRows,
  };
}
