import { and, eq, inArray, isNotNull, isNull, like, lt, lte, notExists, or, sql } from "drizzle-orm";
import {
  authAttempts,
  entries,
  highlights,
  oauthClients,
  oauthCodes,
  oauthGrants,
  oauthTokens,
  users,
  type Db,
} from "../db";
import type { VectorIndex } from "../search";
import { ORPHAN_CLIENT_DAYS } from "./oauth";
import { deleteVectors } from "./search";

export const PURGE_AFTER_DAYS = 30;
const DAY_MS = 86_400_000;

export type PurgeResult = {
  entries: number;
  highlights: number;
  /** The vectors of these highlights are deleted by `runDailyCleanup`. */
  highlightIds: string[];
};

/**
 * Hard-deletes one user's entries and highlights soft-deleted more than 30 x 24 h ago (strict).
 * Entries are locked first (ordered by id) and highlights are deleted by a literal id list, not a
 * subquery, so an entry restored concurrently is never purged by mistake.
 * Tags and artists are shared vocabulary and are left alone.
 */
export async function purgeDeleted(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - PURGE_AFTER_DAYS * DAY_MS);
  return db.transaction(async (tx) => {
    const old = await tx
      .select({ id: entries.id })
      .from(entries)
      .where(and(eq(entries.userId, userId), lt(entries.deletedAt, cutoff)))
      .orderBy(entries.id)
      .for("update");
    const entryIds = old.map((e) => e.id);
    const deletedHighlights = await tx
      .delete(highlights)
      .where(
        and(
          eq(highlights.userId, userId),
          entryIds.length > 0
            ? or(lt(highlights.deletedAt, cutoff), inArray(highlights.entryId, entryIds))
            : lt(highlights.deletedAt, cutoff),
        ),
      )
      .returning({ id: highlights.id });
    if (entryIds.length > 0) {
      await tx.delete(entries).where(and(eq(entries.userId, userId), inArray(entries.id, entryIds)));
    }
    return {
      entries: entryIds.length,
      highlights: deletedHighlights.length,
      highlightIds: deletedHighlights.map((h) => h.id),
    };
  });
}

export type AuthCleanupResult = {
  codes: number;
  tokens: number;
  grants: number;
  clients: number;
  attempts: number;
};

/** Removes expired or dead OAuth rows and finished lockouts (global, not per user). */
export async function cleanupExpiredAuth(
  db: Db,
  now: Date = new Date(),
): Promise<AuthCleanupResult> {
  return db.transaction(async (tx) => {
    const codes = await tx
      .delete(oauthCodes)
      .where(lte(oauthCodes.expiresAt, now))
      .returning({ h: oauthCodes.codeHash });
    // Used-but-unexpired refresh tokens stay: presenting one again is how theft is detected.
    const tokens = await tx
      .delete(oauthTokens)
      .where(lte(oauthTokens.expiresAt, now))
      .returning({ h: oauthTokens.tokenHash });
    const grants = await tx
      .delete(oauthGrants)
      .where(
        notExists(tx.select({ one: sql`1` }).from(oauthTokens).where(eq(oauthTokens.grantId, oauthGrants.id))),
      )
      .returning({ id: oauthGrants.id });
    const orphanCutoff = new Date(now.getTime() - ORPHAN_CLIENT_DAYS * DAY_MS);
    const clients = await tx
      .delete(oauthClients)
      .where(
        and(
          lt(oauthClients.createdAt, orphanCutoff),
          notExists(tx.select({ one: sql`1` }).from(oauthGrants).where(eq(oauthGrants.clientId, oauthClients.id))),
          notExists(tx.select({ one: sql`1` }).from(oauthCodes).where(eq(oauthCodes.clientId, oauthClients.id))),
        ),
      )
      .returning({ id: oauthClients.id });
    const attempts = await tx
      .delete(authAttempts)
      .where(
        or(
          and(isNotNull(authAttempts.lockedUntil), lte(authAttempts.lockedUntil, now)),
          // Per-IP failure counts that never reached a lock have no expiry; the daily sweep resets them.
          and(isNull(authAttempts.lockedUntil), like(authAttempts.key, "login:ip:%")),
        ),
      )
      .returning({ k: authAttempts.key });
    return {
      codes: codes.length,
      tokens: tokens.length,
      grants: grants.length,
      clients: clients.length,
      attempts: attempts.length,
    };
  });
}

export type CleanupSummary = {
  purged: { users: number; entries: number; highlights: number };
  auth: AuthCleanupResult;
};

/** The daily cron: purge every user's old soft-deleted rows, then the expired auth rows. */
export async function runDailyCleanup(
  db: Db,
  now: Date = new Date(),
  /** Vectors of purged highlights are deleted here; a failure is logged and left to the re-sync sweep. */
  index: VectorIndex | null = null,
): Promise<CleanupSummary> {
  const all = await db.select({ id: users.id }).from(users);
  const purged = { users: all.length, entries: 0, highlights: 0 };
  for (const u of all) {
    const r = await purgeDeleted(db, u.id, now);
    purged.entries += r.entries;
    purged.highlights += r.highlights;
    try {
      await deleteVectors(index, r.highlightIds);
    } catch (e) {
      console.error("Deleting vectors of purged highlights failed; the re-sync sweep will remove them", e);
    }
  }
  return { purged, auth: await cleanupExpiredAuth(db, now) };
}
