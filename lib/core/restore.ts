import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { entries, entrySources, highlights, type Db, type Entry } from "../db";
import { findDuplicateEntry, lockSource } from "./entries";
import { CoreError } from "./errors";

export type RestoreResult =
  | { restored: true; entry: Entry }
  | {
      restored: false;
      /** A live entry already has one of this entry's sources; offer to move the highlights onto it instead. */
      conflict: { id: string; title: string };
    };

/** Locks every source of the entry in a fixed order and returns them, so concurrent savers and restores serialize. */
async function lockSources(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], userId: string, entryId: string) {
  const sources = await tx
    .select()
    .from(entrySources)
    .where(eq(entrySources.entryId, entryId))
    .orderBy(asc(entrySources.type), asc(entrySources.externalId));
  for (const s of sources) await lockSource(tx, userId, s.type, s.externalId);
  return sources;
}

async function loadDeletedEntry(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], userId: string, entryId: string) {
  const [entry] = await tx
    .select()
    .from(entries)
    .where(and(eq(entries.id, entryId), eq(entries.userId, userId), isNotNull(entries.deletedAt)))
    .for("update");
  if (!entry || !entry.deletedAt) throw new CoreError("not_found", "Deleted entry not found.");
  return { entry, deletedAt: entry.deletedAt };
}

/**
 * Restores a soft-deleted entry and the highlights that were deleted along with it
 * (same deletion time; highlights deleted on their own earlier stay deleted).
 * Takes the same per-source lock as saving. If a live entry already has one of its sources,
 * nothing changes and the conflicting entry is returned.
 */
export async function restoreEntry(db: Db, userId: string, entryId: string): Promise<RestoreResult> {
  return db.transaction(async (tx): Promise<RestoreResult> => {
    const sources = await lockSources(tx, userId, entryId);
    const { deletedAt } = await loadDeletedEntry(tx, userId, entryId);
    for (const s of sources) {
      const live = await findDuplicateEntry(tx, userId, s.type, s.externalId);
      if (live) return { restored: false, conflict: { id: live.id, title: live.title } };
    }
    const [entry] = await tx
      .update(entries)
      .set({ deletedAt: null })
      .where(and(eq(entries.id, entryId), eq(entries.userId, userId)))
      .returning();
    await tx
      .update(highlights)
      .set({ deletedAt: null, searchDirty: true })
      .where(and(eq(highlights.entryId, entryId), eq(highlights.userId, userId), eq(highlights.deletedAt, deletedAt)));
    return { restored: true, entry };
  });
}

/**
 * Instead of restoring: moves the highlights deleted with a deleted entry onto the live entry
 * that has the same source. The deleted entry stays deleted (the 30-day purge removes it).
 * Returns how many highlights moved.
 */
export async function moveDeletedHighlightsToLiveEntry(db: Db, userId: string, deletedEntryId: string): Promise<{ entryId: string; moved: number }> {
  return db.transaction(async (tx) => {
    const sources = await lockSources(tx, userId, deletedEntryId);
    const { deletedAt } = await loadDeletedEntry(tx, userId, deletedEntryId);
    let live: Entry | null = null;
    for (const s of sources) {
      live = await findDuplicateEntry(tx, userId, s.type, s.externalId);
      if (live) break;
    }
    if (!live) throw new CoreError("invalid_state", "No live entry has this source; restore the entry instead.");
    // Same lock the soft delete and addHighlight take, so the target can't vanish mid-move.
    const [target] = await tx
      .select({ id: entries.id })
      .from(entries)
      .where(and(eq(entries.id, live.id), eq(entries.userId, userId), isNull(entries.deletedAt)))
      .for("update");
    if (!target) throw new CoreError("not_found", "The live entry was deleted; try again.");
    const moved = await tx
      .update(highlights)
      .set({ entryId: live.id, deletedAt: null, searchDirty: true })
      .where(and(eq(highlights.entryId, deletedEntryId), eq(highlights.userId, userId), eq(highlights.deletedAt, deletedAt)))
      .returning({ id: highlights.id });
    return { entryId: live.id, moved: moved.length };
  });
}
