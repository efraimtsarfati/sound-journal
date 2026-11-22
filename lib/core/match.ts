import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { artistGenres, artists, entries, entryArtists, type Artist, type Db, type DbOrTx, type Entry } from "../db";
import {
  lookupArtistGenres,
  lookupRecording,
  MusicBrainzError,
  type MbArtist,
  type MbGenre,
  type MbRecording,
  type MusicBrainzDeps,
} from "../metadata/musicbrainz";
import { markEntryHighlightsDirty } from "./entries";
import { CoreError } from "./errors";
import { normalizeArtistName } from "./text";

export const GENRE_SOURCE = "musicbrainz";
/** Genres older than this are fetched again the next time an entry by the artist is matched. */
const GENRE_STALE_MS = 90 * 24 * 60 * 60 * 1000;

export type MatchConfidence = "high" | "low";
export type MatchResult = {
  entry: Entry;
  /** What happened: `matched`/`confirmed` applied the recording; `candidate` stored it for the user to confirm. */
  outcome: "matched" | "confirmed" | "candidate";
  /** The recording as MusicBrainz reported it. */
  recording: MbRecording;
};

const CONFIRMED_MESSAGE =
  "The owner already confirmed this entry's MusicBrainz match, so it can't be changed. Ask the owner to reject the match in the app first (the song page has a button), then try again.";

function mbError(e: unknown): never {
  if (e instanceof MusicBrainzError) {
    if (e.code === "not_found") throw new CoreError("not_found", "MusicBrainz has no recording with that ID. Nothing was changed.");
    if (e.code === "invalid_id") throw new CoreError("invalid_input", e.message);
    throw new CoreError("invalid_state", `${e.message} Nothing was changed; try again later.`);
  }
  throw e;
}

async function loadLiveEntry(db: DbOrTx, userId: string, entryId: string): Promise<Entry> {
  const [row] = await db
    .select()
    .from(entries)
    .where(and(eq(entries.id, entryId), eq(entries.userId, userId), isNull(entries.deletedAt)));
  if (!row) throw new CoreError("not_found", "Entry not found.");
  return row;
}

/** Which of these artist MBIDs have no fresh genres yet. */
async function staleGenreArtists(db: DbOrTx, mbids: string[]): Promise<Set<string>> {
  if (mbids.length === 0) return new Set();
  const rows = await db
    .select({ mbid: artists.mbid, fetchedAt: artistGenres.fetchedAt })
    .from(artists)
    .innerJoin(artistGenres, and(eq(artistGenres.artistId, artists.id), eq(artistGenres.source, GENRE_SOURCE)))
    .where(inArray(artists.mbid, mbids));
  const fresh = new Set(rows.filter((r) => Date.now() - r.fetchedAt.getTime() < GENRE_STALE_MS).map((r) => r.mbid!));
  return new Set(mbids.filter((m) => !fresh.has(m)));
}

/**
 * Finds or creates the shared artist row for a MusicBrainz artist. Order: the row with that MBID;
 * else a row without an MBID that is already on this entry with the same normalized name; else the
 * oldest MBID-less row with that name (docs/data-model.md, Deduplication), which gets the MBID; else a new row.
 */
async function resolveArtist(tx: DbOrTx, entryId: string, a: MbArtist): Promise<Artist> {
  const [byMbid] = await tx.select().from(artists).where(eq(artists.mbid, a.mbid));
  if (byMbid) return byMbid;
  const norm = normalizeArtistName(a.name);
  if (norm !== "") {
    const onEntry = await tx
      .select({ a: artists })
      .from(entryArtists)
      .innerJoin(artists, eq(artists.id, entryArtists.artistId))
      .where(and(eq(entryArtists.entryId, entryId), eq(artists.nameNormalized, norm), isNull(artists.mbid)))
      .orderBy(asc(artists.createdAt), asc(artists.id))
      .limit(1);
    const [anywhere] = onEntry.length
      ? [onEntry[0].a]
      : await tx
          .select()
          .from(artists)
          .where(and(eq(artists.nameNormalized, norm), isNull(artists.mbid)))
          .orderBy(asc(artists.createdAt), asc(artists.id))
          .limit(1);
    if (anywhere) {
      const [adopted] = await tx.update(artists).set({ mbid: a.mbid, name: a.name }).where(eq(artists.id, anywhere.id)).returning();
      return adopted;
    }
  }
  await tx.insert(artists).values({ name: a.name, nameNormalized: norm, mbid: a.mbid }).onConflictDoNothing({ target: artists.mbid });
  const [row] = await tx.select().from(artists).where(eq(artists.mbid, a.mbid));
  return row;
}

/** Applies a recording to an entry: MusicBrainz title, album and year, linked artists, genres. Raw values stay on the source. */
async function applyRecording(
  db: Db,
  userId: string,
  entryId: string,
  rec: MbRecording,
  genres: Map<string, MbGenre[]>,
  status: "matched" | "confirmed",
): Promise<Entry> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(entries)
      .where(and(eq(entries.id, entryId), eq(entries.userId, userId), isNull(entries.deletedAt)))
      .for("update");
    if (!locked) throw new CoreError("not_found", "Entry not found.");
    // The owner may have confirmed it while MusicBrainz was being asked; only a confirm may write then.
    if (locked.matchStatus === "confirmed" && status !== "confirmed") throw new CoreError("invalid_state", CONFIRMED_MESSAGE);
    const [entry] = await tx
      .update(entries)
      .set({
        mbid: rec.mbid,
        mbidCandidate: null,
        matchStatus: status,
        title: rec.title,
        // Never blank out what we know when MusicBrainz has nothing to offer.
        album: rec.album ?? locked.album,
        originalReleaseYear: rec.year ?? locked.originalReleaseYear,
        updatedAt: new Date(),
      })
      .where(and(eq(entries.id, entryId), eq(entries.userId, userId)))
      .returning();

    if (rec.artists.length > 0) {
      const rows: Artist[] = [];
      for (const a of rec.artists) rows.push(await resolveArtist(tx, entryId, a));
      await tx.delete(entryArtists).where(eq(entryArtists.entryId, entryId));
      await tx
        .insert(entryArtists)
        .values(rows.map((r, i) => ({ entryId, artistId: r.id, role: "primary" as const, position: i })))
        .onConflictDoNothing();
      for (const r of rows) {
        const list = r.mbid ? genres.get(r.mbid) : undefined;
        if (!list) continue; // not fetched (fresh already, or MusicBrainz was unreachable): keep what is stored
        await tx.delete(artistGenres).where(and(eq(artistGenres.artistId, r.id), eq(artistGenres.source, GENRE_SOURCE)));
        if (list.length) {
          await tx.insert(artistGenres).values(list.map((g) => ({ artistId: r.id, genre: g.genre, source: GENRE_SOURCE, weight: g.weight })));
        }
      }
    }
    await markEntryHighlightsDirty(tx as unknown as Db, userId, entryId);
    return entry;
  });
}

async function fetchGenres(db: Db, rec: MbRecording, deps: MusicBrainzDeps): Promise<Map<string, MbGenre[]>> {
  const out = new Map<string, MbGenre[]>();
  const stale = await staleGenreArtists(db, rec.artists.map((a) => a.mbid));
  for (const a of rec.artists) {
    if (!stale.has(a.mbid)) continue;
    try {
      out.set(a.mbid, await lookupArtistGenres(a.mbid, deps));
    } catch (e) {
      if (!(e instanceof MusicBrainzError)) throw e;
      // Genres are a bonus: the match itself still stands, and the genres come on the next match.
    }
  }
  return out;
}

/**
 * Agent-facing "match_entry". `high` applies the recording (status `matched`); `low` only stores the
 * MBID as a candidate for the user to confirm and changes nothing else. The ID is always checked
 * against MusicBrainz first, so an invented one is refused. The network is never used inside a transaction.
 */
export async function matchEntry(
  db: Db,
  userId: string,
  input: { entryId: string; mbid: string; confidence: MatchConfidence },
  deps: MusicBrainzDeps = {},
): Promise<MatchResult> {
  const before = await loadLiveEntry(db, userId, input.entryId);
  if (before.matchStatus === "confirmed") throw new CoreError("invalid_state", CONFIRMED_MESSAGE);
  if (input.confidence === "low" && before.matchStatus !== "unmatched") {
    throw new CoreError("invalid_state", "This entry is already matched; a low-confidence candidate can't replace it.");
  }
  let recording: MbRecording;
  try {
    recording = await lookupRecording(input.mbid, deps);
  } catch (e) {
    return mbError(e);
  }
  if (input.confidence === "low") {
    const [entry] = await db
      .update(entries)
      .set({ mbidCandidate: recording.mbid, updatedAt: new Date() })
      .where(and(eq(entries.id, input.entryId), eq(entries.userId, userId), isNull(entries.deletedAt), eq(entries.matchStatus, "unmatched")))
      .returning();
    if (!entry) throw new CoreError("invalid_state", "This entry changed while matching; try again.");
    return { entry, outcome: "candidate", recording };
  }
  const genres = await fetchGenres(db, recording, deps);
  const entry = await applyRecording(db, userId, input.entryId, recording, genres, "matched");
  return { entry, outcome: "matched", recording };
}

/** The user accepts a stored candidate: the high-confidence path with status `confirmed`. */
export async function confirmMatch(db: Db, userId: string, entryId: string, deps: MusicBrainzDeps = {}): Promise<MatchResult> {
  const before = await loadLiveEntry(db, userId, entryId);
  if (!before.mbidCandidate) throw new CoreError("invalid_state", "This entry has no match waiting to be confirmed.");
  let recording: MbRecording;
  try {
    recording = await lookupRecording(before.mbidCandidate, deps);
  } catch (e) {
    return mbError(e);
  }
  const genres = await fetchGenres(db, recording, deps);
  const entry = await applyRecording(db, userId, entryId, recording, genres, "confirmed");
  return { entry, outcome: "confirmed", recording };
}

/**
 * The user says the match is wrong: a waiting candidate is dropped; a matched or confirmed match is
 * undone (mbid cleared, status back to unmatched) so an agent may match again. Title and artists keep
 * their current values; the raw ones are still on the source.
 */
export async function rejectMatchCandidate(db: Db, userId: string, entryId: string): Promise<Entry> {
  const [entry] = await db
    .update(entries)
    .set({ mbidCandidate: null, mbid: null, matchStatus: "unmatched", updatedAt: new Date() })
    .where(and(eq(entries.id, entryId), eq(entries.userId, userId), isNull(entries.deletedAt)))
    .returning();
  if (!entry) throw new CoreError("not_found", "Entry not found.");
  return entry;
}
