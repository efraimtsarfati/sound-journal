import { and, eq, isNull } from "drizzle-orm";
import {
  entries,
  entrySources,
  highlights,
  type Db,
  type Entry,
  type EntrySource,
  type Highlight,
} from "../db";
import { CoreError } from "./errors";
import { initialStatus, type HighlightInput } from "./highlights";
import { assertTimes, normalizeNote } from "./text";

export type SourceInput = {
  type: "youtube";
  externalId: string;
  url: string;
  rawTitle?: string | null;
  rawAuthor?: string | null;
};

export type AddEntryInput = {
  title: string;
  album?: string | null;
  originalReleaseYear?: number | null;
  durationSec?: number | null;
  source: SourceInput;
  highlight?: HighlightInput;
};

export type AddEntryResult =
  | { duplicate: Entry }
  | { duplicate?: undefined; entry: Entry; source: EntrySource; highlight: Highlight };

/** Finds a live entry the user already saved from this source, or null. */
export async function findDuplicateEntry(
  db: Db,
  userId: string,
  type: EntrySource["type"],
  externalId: string,
): Promise<Entry | null> {
  const [row] = await db
    .select({ e: entries })
    .from(entrySources)
    .innerJoin(entries, eq(entries.id, entrySources.entryId))
    .where(
      and(
        eq(entries.userId, userId),
        isNull(entries.deletedAt),
        eq(entrySources.type, type),
        eq(entrySources.externalId, externalId),
      ),
    );
  return row?.e ?? null;
}

/**
 * Creates an entry with its source and a first highlight (whole work unless times are given).
 * Returns `{ duplicate: entry }` without writing if the source is already saved.
 */
export async function addEntry(db: Db, userId: string, input: AddEntryInput): Promise<AddEntryResult> {
  const title = input.title.trim();
  if (title === "") throw new CoreError("invalid_input", "An entry needs a title.");
  if (input.source.type !== "youtube") {
    throw new CoreError("invalid_input", "Only YouTube sources are supported in v1.");
  }
  if (input.source.externalId.trim() === "") {
    throw new CoreError("invalid_input", "A source needs an external ID.");
  }
  const startSec = input.highlight?.startSec ?? null;
  const endSec = input.highlight?.endSec ?? null;
  assertTimes(startSec, endSec);
  const note = normalizeNote(input.highlight?.note);

  const existing = await findDuplicateEntry(db, userId, input.source.type, input.source.externalId);
  if (existing) return { duplicate: existing };

  return db.transaction(async (tx) => {
    const [entry] = await tx
      .insert(entries)
      .values({
        userId,
        title,
        album: input.album ?? null,
        originalReleaseYear: input.originalReleaseYear ?? null,
        durationSec: input.durationSec ?? null,
      })
      .returning();
    const [source] = await tx
      .insert(entrySources)
      .values({
        entryId: entry.id,
        type: input.source.type,
        externalId: input.source.externalId,
        url: input.source.url,
        rawTitle: input.source.rawTitle ?? null,
        rawAuthor: input.source.rawAuthor ?? null,
      })
      .returning();
    const [highlight] = await tx
      .insert(highlights)
      .values({
        entryId: entry.id,
        userId,
        startSec,
        endSec,
        note,
        status: initialStatus(note),
        noteUpdatedAt: note === null ? null : new Date(),
        searchDirty: true,
      })
      .returning();
    return { entry, source, highlight };
  });
}

/** Soft-deletes an entry and all its live highlights in one transaction. */
export async function softDeleteEntry(db: Db, userId: string, entryId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .update(entries)
      .set({ deletedAt: now })
      .where(and(eq(entries.id, entryId), eq(entries.userId, userId), isNull(entries.deletedAt)))
      .returning({ id: entries.id });
    if (!row) throw new CoreError("not_found", "Entry not found.");
    await tx
      .update(highlights)
      .set({ deletedAt: now })
      .where(and(eq(highlights.entryId, entryId), eq(highlights.userId, userId), isNull(highlights.deletedAt)));
  });
}

/**
 * Marks every live highlight of an entry dirty for search. Call after an entry
 * title or artist change (docs/architecture.md, Search sync).
 */
export async function markEntryHighlightsDirty(db: Db, userId: string, entryId: string): Promise<void> {
  await db
    .update(highlights)
    .set({ searchDirty: true })
    .where(and(eq(highlights.entryId, entryId), eq(highlights.userId, userId), isNull(highlights.deletedAt)));
}
