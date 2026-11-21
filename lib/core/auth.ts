import { eq } from "drizzle-orm";
import { safeEqual } from "../auth/crypto";
import { authAttempts, type Db } from "../db";

export const LOGIN_KEY = "login";
export const MAX_FAILS = 5;
export const LOCK_SECONDS = 15 * 60;

/** Constant-time password check (compares SHA-256 digests so lengths never leak). */
export function passwordMatches(expected: string | undefined, given: string): boolean {
  if (!expected) return false;
  return safeEqual(expected, given);
}

/** Seconds left on the lock for `key`, or 0 when it isn't locked. */
export async function lockRemainingSec(
  db: Db,
  key: string,
  now: Date = new Date(),
): Promise<number> {
  const [row] = await db.select().from(authAttempts).where(eq(authAttempts.key, key));
  if (!row?.lockedUntil || row.lockedUntil <= now) return 0;
  return Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 1000);
}

export async function clearFailures(db: Db, key: string): Promise<void> {
  await db.delete(authAttempts).where(eq(authAttempts.key, key));
}

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: "locked"; retryAfterSec: number }
  | { ok: false; reason: "invalid" };

/**
 * One transaction with the key row locked, so parallel requests cannot bypass the lockout.
 * Refuses while locked (without comparing or counting), counts failures (the MAX_FAILS-th
 * locks the key for LOCK_SECONDS; an expired lock starts a fresh count) and resets the row (0 fails,
 * no lock) on success. Shared by the login form and the OAuth consent page (same `login` key).
 */
export async function attemptLogin(
  db: Db,
  expectedPassword: string | undefined,
  given: string,
  now: Date = new Date(),
): Promise<LoginResult> {
  return db.transaction(async (tx): Promise<LoginResult> => {
    await tx.insert(authAttempts).values({ key: LOGIN_KEY }).onConflictDoNothing();
    const lockRow = () =>
      tx.select().from(authAttempts).where(eq(authAttempts.key, LOGIN_KEY)).for("update");
    let [row] = await lockRow();
    if (!row) {
      // The row vanished between our insert and select (a concurrent clearFailures): put it back.
      await tx.insert(authAttempts).values({ key: LOGIN_KEY }).onConflictDoNothing();
      [row] = await lockRow();
    }
    if (row.lockedUntil && row.lockedUntil > now) {
      return {
        ok: false,
        reason: "locked",
        retryAfterSec: Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 1000),
      };
    }
    if (passwordMatches(expectedPassword, given)) {
      await tx
        .update(authAttempts)
        .set({ fails: 0, lockedUntil: null })
        .where(eq(authAttempts.key, LOGIN_KEY));
      return { ok: true };
    }
    const expired = !!row.lockedUntil && row.lockedUntil <= now;
    const fails = (expired ? 0 : row.fails) + 1;
    const lockedUntil = fails >= MAX_FAILS ? new Date(now.getTime() + LOCK_SECONDS * 1000) : null;
    await tx.update(authAttempts).set({ fails, lockedUntil }).where(eq(authAttempts.key, LOGIN_KEY));
    if (lockedUntil) return { ok: false, reason: "locked", retryAfterSec: LOCK_SECONDS };
    return { ok: false, reason: "invalid" };
  });
}
