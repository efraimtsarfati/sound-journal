import { and, count, eq, isNull } from "drizzle-orm";
import { entries, highlights, type Db, type DbOrTx, type Highlight } from "../db";
import { CoreError } from "./errors";
import { assertTimes, normalizeNote } from "./text";

/** Loads a live highlight (on a live entry) owned by the user, or throws not_found. */
export async function loadHighlight(
  db: DbOrTx,
  userId: string,
  highlightId: string,
  opts: { lock?: boolean } = {},
): Promise<Highlight> {
  const q = db
    .select({ h: highlights })
    .from(highlights)
    .innerJoin(entries, and(eq(entries.id, highlights.entryId), eq(entries.userId, highlights.userId)))
    .where(
      and(
        eq(highlights.id, highlightId),
        eq(highlights.userId, userId),
        isNull(highlights.deletedAt),
        isNull(entries.deletedAt),
      ),
    );
  const [row] = await (opts.lock ? q.for("update", { of: highlights }) : q);
  if (!row) throw new CoreError("not_found", "Highlight not found.");
  return row.h;
}

export type HighlightInput = {
  startSec?: number | null;
  endSec?: number | null;
  note?: string | null;
};

/** Initial workflow status: a note makes it needs_tags, no note needs_why. */
export function initialStatus(note: string | null): "needs_why" | "needs_tags" {
  return note === null ? "needs_why" : "needs_tags";
}

/** Adds a highlight to a live entry. A note is never required. */
export async function addHighlight(
  db: Db,
  userId: string,
  entryId: string,
  input: HighlightInput = {},
): Promise<Highlight> {
  const startSec = input.startSec ?? null;
  const endSec = input.endSec ?? null;
  assertTimes(startSec, endSec);
  const note = normalizeNote(input.note);
  // Lock the entry row (soft delete takes the same lock) so the entry can't be deleted mid-insert.
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select({ id: entries.id })
      .from(entries)
      .where(and(eq(entries.id, entryId), eq(entries.userId, userId), isNull(entries.deletedAt)))
      .for("update");
    if (!entry) throw new CoreError("not_found", "Entry not found.");
    const [row] = await tx
      .insert(highlights)
      .values({
        entryId,
        userId,
        startSec,
        endSec,
        note,
        status: initialStatus(note),
        noteUpdatedAt: note === null ? null : new Date(),
        searchDirty: true,
      })
      .returning();
    return row;
  });
}

/**
 * Sets or clears a highlight's note and applies the status transitions from
 * docs/data-model.md. Tags are kept. A change marks the vector copy dirty.
 */
export async function setHighlightNote(
  db: Db,
  userId: string,
  highlightId: string,
  rawNote: string | null,
): Promise<Highlight> {
  const note = normalizeNote(rawNote);
  return db.transaction(async (tx) => {
    const current = await loadHighlight(tx, userId, highlightId, { lock: true });
    if (note === current.note) return current;
    // Cleared -> needs_why. Added or edited -> needs_tags (tagged goes back for review).
    const status = note === null ? "needs_why" : "needs_tags";
    const [row] = await tx
      .update(highlights)
      .set({ note, status, noteUpdatedAt: new Date(), searchDirty: true })
      .where(and(eq(highlights.id, highlightId), eq(highlights.userId, userId)))
      .returning();
    return row;
  });
}

/** Soft-deletes a highlight. Refused for the last live highlight of its entry: delete the entry instead. */
export async function softDeleteHighlight(db: Db, userId: string, highlightId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const h = await loadHighlight(tx, userId, highlightId);
    // Serialize with other deletes on this entry so two can't both see "2 live" and both proceed.
    await tx
      .select({ id: entries.id })
      .from(entries)
      .where(and(eq(entries.id, h.entryId), eq(entries.userId, userId)))
      .for("update");
    const [{ n }] = await tx
      .select({ n: count() })
      .from(highlights)
      .where(and(eq(highlights.entryId, h.entryId), eq(highlights.userId, userId), isNull(highlights.deletedAt)));
    if (n <= 1) {
      throw new CoreError(
        "last_highlight",
        "An entry keeps at least one highlight. Delete the entry instead.",
      );
    }
    await tx
      .update(highlights)
      .set({ deletedAt: new Date() })
      .where(and(eq(highlights.id, highlightId), eq(highlights.userId, userId)));
  });
}
