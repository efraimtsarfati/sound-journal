import { and, eq, isNotNull } from "drizzle-orm";
import { artists, entries, entryArtists, highlights, type Db, type Entry, type Highlight } from "../db";
import { fetchOEmbed, parseYouTubeUrl, YOUTUBE_SOURCE_TYPE, youtubeWatchUrl, YouTubeError, deriveTitleArtist } from "../sources/youtube";
import { addEntry, findDuplicateEntry, lockSource } from "./entries";
import { CoreError } from "./errors";
import { addHighlight, initialStatus, loadHighlight, type HighlightInput } from "./highlights";
import { assertTimes, normalizeNote } from "./text";

export type AgentEntryInput = {
  url: string;
  title?: string;
  artists?: string[];
  album?: string | null;
  originalReleaseYear?: number | null;
  highlights?: HighlightInput[];
};

export type AgentAddResult = {
  /** True when a new entry was created; false when the URL was already saved and highlights were added to it. */
  created: boolean;
  entry: Entry;
  highlights: Highlight[];
  /** Metadata that was ignored because the entry already existed. */
  ignored: string[];
};

const normalizeArtistName = (n: string) => n.trim().replace(/\s+/g, " ").toLowerCase();

/** Reuses a shared artist row with the same normalized name, else creates one (no MBID until M7). */
async function attachArtists(db: Db, entryId: string, names: string[]): Promise<void> {
  const seen = new Set<string>();
  let position = 0;
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, " ");
    const norm = normalizeArtistName(name);
    if (norm === "" || seen.has(norm)) continue;
    seen.add(norm);
    const [existing] = await db.select().from(artists).where(eq(artists.nameNormalized, norm)).limit(1);
    const artist =
      existing ?? (await db.insert(artists).values({ name, nameNormalized: norm }).returning())[0];
    await db
      .insert(entryArtists)
      .values({ entryId, artistId: artist.id, role: "primary", position: position++ })
      .onConflictDoNothing();
  }
}

/**
 * Agent-facing "add_entry": saves a YouTube link with its highlights, or adds the highlights to the
 * entry that already has the link. A missing title is read from YouTube's oEmbed; if that gives
 * nothing, the call is refused rather than inventing one.
 */
export async function addEntryForAgent(
  db: Db,
  userId: string,
  input: AgentEntryInput,
  deps: NonNullable<Parameters<typeof fetchOEmbed>[1]> = {},
): Promise<AgentAddResult> {
  const parsed = parseYouTubeUrl(input.url);
  if (!parsed) throw new CoreError("invalid_input", "That is not a YouTube link; only YouTube links are supported in v1.");
  const hls = input.highlights ?? [];
  // Validate everything before the first write so a bad highlight can't leave a half-saved entry.
  for (const h of hls) {
    assertTimes(h.startSec ?? null, h.endSec ?? null);
    normalizeNote(h.note);
  }
  const yr = input.originalReleaseYear;
  if (yr != null && (!Number.isInteger(yr) || yr < 1000 || yr > 3000)) {
    throw new CoreError("invalid_input", "original_release_year must be a four-digit year.");
  }

  // One transaction (holding the source lock) so a failure leaves nothing partial and a retry can't double-save.
  return db.transaction(async (tx): Promise<AgentAddResult> => {
    await lockSource(tx, userId, YOUTUBE_SOURCE_TYPE, parsed.videoId);
    const existing = await findDuplicateEntry(tx, userId, YOUTUBE_SOURCE_TYPE, parsed.videoId);
    if (existing) {
      const added: Highlight[] = [];
      for (const h of hls) added.push(await addHighlight(tx, userId, existing.id, h));
      const hasMeta = Boolean(input.title?.trim() || input.album || input.originalReleaseYear != null || input.artists?.length);
      const ignored = hasMeta
        ? ["title, artists, album and year (the entry already exists; they were not changed)"]
        : [];
      return { created: false, entry: existing, highlights: added, ignored };
    }

    let title = input.title?.trim() ?? "";
    let rawTitle: string | null = null;
    let rawAuthor: string | null = null;
    if (title === "") {
      try {
        const o = await fetchOEmbed(parsed.videoId, deps);
        rawTitle = o.rawTitle;
        rawAuthor = o.rawChannel;
        title = deriveTitleArtist(o.rawTitle, o.rawChannel ?? "").title.trim();
      } catch (e) {
        if (!(e instanceof YouTubeError)) throw e;
      }
      if (title === "") {
        throw new CoreError("invalid_input", "Could not read a title from YouTube. Pass the song's clean `title`.");
      }
    }

    const [first, ...rest] = hls;
    const result = await addEntry(tx, userId, {
      title,
      album: input.album ?? null,
      originalReleaseYear: input.originalReleaseYear ?? null,
      source: { type: "youtube", externalId: parsed.videoId, url: youtubeWatchUrl(parsed.videoId), rawTitle, rawAuthor },
      highlight: first,
    });
    if (result.duplicate) {
      // Another saver won the race; add everything to their entry.
      const added: Highlight[] = [];
      for (const h of hls) added.push(await addHighlight(tx, userId, result.duplicate.id, h));
      return { created: false, entry: result.duplicate, highlights: added, ignored: [] };
    }
    const added: Highlight[] = [result.highlight];
    for (const h of rest) added.push(await addHighlight(tx, userId, result.entry.id, h));
    if (input.artists?.length) await attachArtists(tx, result.entry.id, input.artists);
    return { created: true, entry: result.entry, highlights: added, ignored: [] };
  });
}

export type HighlightPatch = {
  note?: string | null;
  startSec?: number | null;
  endSec?: number | null;
};

/**
 * Edits a highlight's note and/or times; omitted fields stay as they are. A note change follows the
 * status transitions in docs/data-model.md (cleared -> needs_why, added or edited -> needs_tags);
 * a times-only change keeps the status. Tags are kept.
 */
export async function updateHighlight(db: Db, userId: string, highlightId: string, patch: HighlightPatch): Promise<Highlight> {
  if (patch.note === undefined && patch.startSec === undefined && patch.endSec === undefined) {
    throw new CoreError("invalid_input", "Nothing to change: give note, start_sec or end_sec.");
  }
  return db.transaction(async (tx) => {
    const cur = await loadHighlight(tx, userId, highlightId, { lock: true });
    const startSec = patch.startSec === undefined ? cur.startSec : patch.startSec;
    let endSec = patch.endSec === undefined ? cur.endSec : patch.endSec;
    // Clearing the start also clears an end the caller did not mention.
    if (patch.startSec === null && patch.endSec === undefined) endSec = null;
    assertTimes(startSec, endSec);
    const note = patch.note === undefined ? cur.note : normalizeNote(patch.note);
    const noteChanged = note !== cur.note;
    const timesChanged = startSec !== cur.startSec || endSec !== cur.endSec;
    if (!noteChanged && !timesChanged) return cur;
    const [row] = await tx
      .update(highlights)
      .set({
        startSec,
        endSec,
        ...(noteChanged ? { note, status: initialStatus(note), noteUpdatedAt: new Date(), searchDirty: true } : {}),
      })
      .where(and(eq(highlights.id, highlightId), eq(highlights.userId, userId)))
      .returning();
    return row;
  });
}

/** Undoes the soft delete of one highlight whose entry is live. A highlight of a deleted entry needs the entry restored. */
export async function restoreHighlight(db: Db, userId: string, highlightId: string): Promise<Highlight> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ h: highlights, entryDeleted: entries.deletedAt })
      .from(highlights)
      .innerJoin(entries, and(eq(entries.id, highlights.entryId), eq(entries.userId, highlights.userId)))
      .where(and(eq(highlights.id, highlightId), eq(highlights.userId, userId), isNotNull(highlights.deletedAt)))
      .for("update", { of: highlights });
    if (!row) throw new CoreError("not_found", "Deleted highlight not found.");
    if (row.entryDeleted) {
      throw new CoreError("invalid_state", "This highlight's entry is deleted too. Restore the entry instead (restore_deleted with entry_id).");
    }
    const [restored] = await tx
      .update(highlights)
      .set({ deletedAt: null, searchDirty: true })
      .where(and(eq(highlights.id, highlightId), eq(highlights.userId, userId)))
      .returning();
    return restored;
  });
}
