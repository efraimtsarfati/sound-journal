import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import axes from "../../taxonomy/axes.json";
import {
  artistGenres,
  artists,
  entries,
  entryArtists,
  entrySources,
  highlightTags,
  highlights,
  settings,
  tags,
  type Db,
  type DbOrTx,
  type Entry,
  type EntrySource,
  type Highlight,
  type Tag,
} from "../db";
import { parseYouTubeUrl, YOUTUBE_SOURCE_TYPE } from "../sources/youtube";
import { findDuplicateEntry } from "./entries";
import { CoreError } from "./errors";
import { AXIS_IDS } from "./text";

/** Connector switches (docs/mcp-server.md). A missing settings row means the documented defaults. */
export type ConnectorSettings = { enabled: boolean; allowChanges: boolean; allowDeletes: boolean };

export async function getConnectorSettings(db: DbOrTx, userId: string): Promise<ConnectorSettings> {
  const [row] = await db.select().from(settings).where(eq(settings.userId, userId));
  if (!row) return { enabled: true, allowChanges: true, allowDeletes: false };
  return { enabled: row.mcpEnabled, allowChanges: row.mcpAllowChanges, allowDeletes: row.mcpAllowDeletes };
}

export type AgentTag = Pick<Tag, "id" | "axis" | "name" | "state">;
export type AgentHighlight = Highlight & {
  tags: AgentTag[];
  entry: { id: string; title: string; artists: string[]; url: string | null };
};

const clampLimit = (n: number | undefined, def: number, max: number) =>
  Math.min(Math.max(Math.trunc(n ?? def), 1), max);

/** Adds entry info (title, artists, first source URL) and live tags to a list of highlights. */
async function decorate(db: DbOrTx, userId: string, rows: Highlight[]): Promise<AgentHighlight[]> {
  if (rows.length === 0) return [];
  const entryIds = [...new Set(rows.map((h) => h.entryId))];
  const hlIds = rows.map((h) => h.id);
  const [entryRows, artistRows, sourceRows, tagRows] = await Promise.all([
    db.select().from(entries).where(and(inArray(entries.id, entryIds), eq(entries.userId, userId))),
    db
      .select({ entryId: entryArtists.entryId, name: artists.name })
      .from(entryArtists)
      .innerJoin(artists, eq(artists.id, entryArtists.artistId))
      .where(inArray(entryArtists.entryId, entryIds))
      .orderBy(asc(entryArtists.position)),
    db.select().from(entrySources).where(inArray(entrySources.entryId, entryIds)).orderBy(asc(entrySources.addedAt)),
    db
      .select({ highlightId: highlightTags.highlightId, id: tags.id, axis: tags.axis, name: tags.name, state: tags.state })
      .from(highlightTags)
      .innerJoin(tags, and(eq(tags.id, highlightTags.tagId), eq(tags.userId, userId)))
      .where(inArray(highlightTags.highlightId, hlIds))
      .orderBy(asc(highlightTags.addedAt)),
  ]);
  return rows.map((h) => {
    const e = entryRows.find((x) => x.id === h.entryId);
    return {
      ...h,
      tags: tagRows
        .filter((t) => t.highlightId === h.id && t.state !== "rejected" && t.state !== "merged")
        .map(({ id, axis, name, state }) => ({ id, axis, name, state })),
      entry: {
        id: h.entryId,
        title: e?.title ?? "",
        artists: artistRows.filter((a) => a.entryId === h.entryId).map((a) => a.name),
        url: sourceRows.find((s) => s.entryId === h.entryId)?.url ?? null,
      },
    };
  });
}

/** Highlights waiting on a note (`needs_why`) or tags (`needs_tags`), oldest first. */
export async function listInbox(db: DbOrTx, userId: string, opts: { limit?: number } = {}) {
  const limit = clampLimit(opts.limit, 50, 200);
  const rows = await db
    .select({ h: highlights })
    .from(highlights)
    .innerJoin(entries, and(eq(entries.id, highlights.entryId), eq(entries.userId, highlights.userId)))
    .where(
      and(
        eq(highlights.userId, userId),
        isNull(highlights.deletedAt),
        isNull(entries.deletedAt),
        ne(highlights.status, "tagged"),
      ),
    )
    .orderBy(asc(highlights.capturedAt), asc(highlights.id))
    .limit(limit);
  return decorate(db, userId, rows.map((r) => r.h));
}

export type TaxonomyTag = Tag & { uses: number };

/** Axes (from axes.json), every approved/proposed tag with its live usage count, and rejected slugs. */
export async function getTaxonomy(db: DbOrTx, userId: string) {
  const rows = await db
    .select({ tag: tags, uses: count(highlights.id) })
    .from(tags)
    .leftJoin(highlightTags, eq(highlightTags.tagId, tags.id))
    .leftJoin(
      highlights,
      and(eq(highlights.id, highlightTags.highlightId), eq(highlights.userId, userId), isNull(highlights.deletedAt)),
    )
    .where(and(eq(tags.userId, userId), or(eq(tags.state, "approved"), eq(tags.state, "proposed"), eq(tags.state, "rejected"))))
    .groupBy(tags.id)
    .orderBy(asc(tags.axis), asc(tags.name));
  return {
    axes: axes.axes,
    tags: rows.filter((r) => r.tag.state !== "rejected").map((r) => ({ ...r.tag, uses: r.uses }) as TaxonomyTag),
    rejected: rows.filter((r) => r.tag.state === "rejected").map((r) => ({ axis: r.tag.axis, slug: r.tag.slug })),
  };
}

export type SearchFilters = {
  /** Meaning search arrives with the vector index (M6); until then this is a case-insensitive text match on the note. */
  query?: string;
  tags?: string[];
  axis?: string;
  artist?: string;
  status?: "needs_why" | "needs_tags" | "tagged";
  from?: Date;
  to?: Date;
  limit?: number;
};

/** Live highlights on live entries matching every given filter, newest captured first. */
export async function searchHighlights(db: DbOrTx, userId: string, f: SearchFilters = {}) {
  if (f.axis && !AXIS_IDS.includes(f.axis)) {
    throw new CoreError("invalid_input", `Unknown axis "${f.axis}". Expected one of: ${AXIS_IDS.join(", ")}.`);
  }
  const conds = [
    eq(highlights.userId, userId),
    isNull(highlights.deletedAt),
    isNull(entries.deletedAt),
  ];
  if (f.status) conds.push(eq(highlights.status, f.status));
  if (f.from) conds.push(gte(highlights.capturedAt, f.from));
  if (f.to) conds.push(lt(highlights.capturedAt, f.to));
  if (f.query?.trim()) {
    const like = `%${f.query.trim().replace(/[\\%_]/g, "\\$&")}%`;
    conds.push(ilike(highlights.note, like));
  }
  const liveTag = and(
    eq(highlightTags.highlightId, highlights.id),
    eq(tags.id, highlightTags.tagId),
    eq(tags.userId, userId),
    or(eq(tags.state, "approved"), eq(tags.state, "proposed")),
  );
  for (const name of f.tags ?? []) {
    conds.push(
      sql`exists (select 1 from ${highlightTags}, ${tags} where ${and(liveTag, sql`lower(${tags.name}) = ${name.trim().toLowerCase()}`)})`,
    );
  }
  if (f.axis) {
    conds.push(sql`exists (select 1 from ${highlightTags}, ${tags} where ${and(liveTag, eq(tags.axis, f.axis))})`);
  }
  if (f.artist?.trim()) {
    conds.push(
      sql`exists (select 1 from ${entryArtists} join ${artists} on ${artists.id} = ${entryArtists.artistId} where ${entryArtists.entryId} = ${entries.id} and lower(${artists.name}) = ${f.artist.trim().toLowerCase()})`,
    );
  }
  const rows = await db
    .select({ h: highlights })
    .from(highlights)
    .innerJoin(entries, and(eq(entries.id, highlights.entryId), eq(entries.userId, highlights.userId)))
    .where(and(...conds))
    .orderBy(desc(highlights.capturedAt), desc(highlights.id))
    .limit(clampLimit(f.limit, 20, 100));
  return decorate(db, userId, rows.map((r) => r.h));
}

export type AgentEntry = {
  entry: Entry;
  sources: EntrySource[];
  artists: { name: string; role: "primary" | "featured"; genres: string[] }[];
  highlights: AgentHighlight[];
};

async function loadAgentEntries(db: DbOrTx, userId: string, rows: Entry[]): Promise<AgentEntry[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((e) => e.id);
  const [sources, links, hl] = await Promise.all([
    db.select().from(entrySources).where(inArray(entrySources.entryId, ids)).orderBy(asc(entrySources.addedAt)),
    db
      .select({ entryId: entryArtists.entryId, artistId: artists.id, name: artists.name, role: entryArtists.role })
      .from(entryArtists)
      .innerJoin(artists, eq(artists.id, entryArtists.artistId))
      .where(inArray(entryArtists.entryId, ids))
      .orderBy(asc(entryArtists.position)),
    db
      .select()
      .from(highlights)
      .where(and(inArray(highlights.entryId, ids), eq(highlights.userId, userId), isNull(highlights.deletedAt)))
      .orderBy(asc(highlights.startSec), asc(highlights.createdAt)),
  ]);
  const artistIds = [...new Set(links.map((l) => l.artistId))];
  const genreRows = artistIds.length
    ? await db.select().from(artistGenres).where(inArray(artistGenres.artistId, artistIds)).orderBy(desc(artistGenres.weight))
    : [];
  const decorated = await decorate(db, userId, hl);
  return rows.map((entry) => ({
    entry,
    sources: sources.filter((s) => s.entryId === entry.id),
    artists: links
      .filter((l) => l.entryId === entry.id)
      .map((l) => ({
        name: l.name,
        role: l.role,
        genres: [...new Set(genreRows.filter((g) => g.artistId === l.artistId).map((g) => g.genre))],
      })),
    highlights: decorated.filter((h) => h.entryId === entry.id),
  }));
}

/** One live entry by id or by saved source URL (YouTube in v1), with sources, artists, genres and live highlights. */
export async function getEntryForAgent(
  db: Db,
  userId: string,
  by: { entryId?: string; url?: string },
): Promise<AgentEntry | null> {
  if (!by.entryId === !by.url) throw new CoreError("invalid_input", "Give exactly one of entry_id or url.");
  let row: Entry | null | undefined;
  if (by.entryId) {
    [row] = await db
      .select()
      .from(entries)
      .where(and(eq(entries.id, by.entryId), eq(entries.userId, userId), isNull(entries.deletedAt)));
  } else {
    const parsed = parseYouTubeUrl(by.url!);
    if (!parsed) throw new CoreError("invalid_input", "That is not a YouTube link; only YouTube links are supported in v1.");
    row = await findDuplicateEntry(db, userId, YOUTUBE_SOURCE_TYPE, parsed.videoId);
  }
  return row ? (await loadAgentEntries(db, userId, [row]))[0] : null;
}

/** Live entries, newest first. `cursor` is the opaque `nextCursor` of the previous page. */
export async function listEntriesForAgent(
  db: DbOrTx,
  userId: string,
  opts: { limit?: number; cursor?: string; artist?: string } = {},
): Promise<{ items: AgentEntry[]; nextCursor: string | null }> {
  const limit = clampLimit(opts.limit, 20, 100);
  let offset = 0;
  if (opts.cursor !== undefined) {
    offset = Number(opts.cursor);
    if (!Number.isInteger(offset) || offset < 0) throw new CoreError("invalid_input", "Invalid cursor.");
  }
  const conds = [eq(entries.userId, userId), isNull(entries.deletedAt)];
  if (opts.artist?.trim()) {
    conds.push(
      sql`exists (select 1 from ${entryArtists} join ${artists} on ${artists.id} = ${entryArtists.artistId} where ${entryArtists.entryId} = ${entries.id} and lower(${artists.name}) = ${opts.artist.trim().toLowerCase()})`,
    );
  }
  const rows = await db
    .select()
    .from(entries)
    .where(and(...conds))
    .orderBy(desc(entries.createdAt), desc(entries.id))
    .limit(limit + 1)
    .offset(offset);
  const page = rows.slice(0, limit);
  return {
    items: await loadAgentEntries(db, userId, page),
    nextCursor: rows.length > limit ? String(offset + limit) : null,
  };
}
