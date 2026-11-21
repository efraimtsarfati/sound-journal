import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { authAttempts, type Db } from "../db";

export const LOGIN_KEY = "login";
export const MAX_FAILS = 5;
export const LOCK_SECONDS = 15 * 60;

/** Constant-time password check (compares SHA-256 digests so lengths never leak). */
export function passwordMatches(expected: string | undefined, given: string): boolean {
  if (!expected) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(given).digest();
  return timingSafeEqual(a, b);
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

/**
 * Records a failed attempt; the MAX_FAILS-th failure locks the key for LOCK_SECONDS.
 * An expired lock starts a fresh count.
 */
export async function recordFailure(
  db: Db,
  key: string,
  now: Date = new Date(),
): Promise<{ fails: number; lockedUntil: Date | null }> {
  return db.transaction(async (tx) => {
    await tx.insert(authAttempts).values({ key }).onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(authAttempts)
      .where(eq(authAttempts.key, key))
      .for("update");
    const expired = !!row.lockedUntil && row.lockedUntil <= now;
    const fails = (expired ? 0 : row.fails) + 1;
    const lockedUntil =
      fails >= MAX_FAILS
        ? new Date(now.getTime() + LOCK_SECONDS * 1000)
        : expired
          ? null
          : row.lockedUntil;
    await tx.update(authAttempts).set({ fails, lockedUntil }).where(eq(authAttempts.key, key));
    return { fails, lockedUntil };
  });
}

export async function clearFailures(db: Db, key: string): Promise<void> {
  await db.delete(authAttempts).where(eq(authAttempts.key, key));
}

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: "locked"; retryAfterSec: number }
  | { ok: false; reason: "invalid" };

/** Refuses while locked (without checking the password), counts failures, resets on success. */
export async function attemptLogin(
  db: Db,
  expectedPassword: string | undefined,
  given: string,
  now: Date = new Date(),
): Promise<LoginResult> {
  const remaining = await lockRemainingSec(db, LOGIN_KEY, now);
  if (remaining > 0) return { ok: false, reason: "locked", retryAfterSec: remaining };
  if (passwordMatches(expectedPassword, given)) {
    await clearFailures(db, LOGIN_KEY);
    return { ok: true };
  }
  const { lockedUntil } = await recordFailure(db, LOGIN_KEY, now);
  if (lockedUntil) {
    return {
      ok: false,
      reason: "locked",
      retryAfterSec: Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000),
    };
  }
  return { ok: false, reason: "invalid" };
}
