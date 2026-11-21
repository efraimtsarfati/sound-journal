import { eq } from "drizzle-orm";
import { safeEqual } from "../auth/crypto";
import { authAttempts, type Db } from "../db";
import { bumpCounter, ipKeyPart, readCounter } from "./rate-limit";

export const LOGIN_KEY = "login";
export const MAX_FAILS = 5;
export const LOCK_SECONDS = 15 * 60;
/** Global backstop across all IPs: after 50 wrong passwords in an hour every attempt is delayed (never locked). */
export const GLOBAL_KEY = "login:global";
export const GLOBAL_WINDOW_SEC = 3600;
export const GLOBAL_SLOW_AFTER = 50;
export const GLOBAL_DELAY_MS = 3000;

export type LoginOptions = {
  /** Client IP; failures and the lockout are then counted per IP. Without it (tests only; the web routes always pass one, "unknown" when no header) the legacy shared `login` key is used. */
  ip?: string;
  /** Replaces the real delay in tests. */
  sleep?: (ms: number) => Promise<void>;
};
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
 * no lock) on success. Shared by the login form and the OAuth consent page (same `login:ip:<ip>` key).
 */
export async function attemptLogin(
  db: Db,
  expectedPassword: string | undefined,
  given: string,
  now: Date = new Date(),
  opts: LoginOptions = {},
): Promise<LoginResult> {
  // Per client IP when the caller knows it (the web routes always do); the legacy shared `login` key otherwise (no route does this).
  const key = opts.ip === undefined ? LOGIN_KEY : `${LOGIN_KEY}:ip:${ipKeyPart(opts.ip)}`;
  // Global backstop: past GLOBAL_SLOW_AFTER failures this hour every attempt waits first. It never locks.
  if ((await readCounter(db, GLOBAL_KEY, GLOBAL_WINDOW_SEC, now)) >= GLOBAL_SLOW_AFTER) {
    await (opts.sleep ?? defaultSleep)(GLOBAL_DELAY_MS);
  }
  return db.transaction(async (tx): Promise<LoginResult> => {
    await tx.insert(authAttempts).values({ key }).onConflictDoNothing();
    const lockRow = () => tx.select().from(authAttempts).where(eq(authAttempts.key, key)).for("update");
    let [row] = await lockRow();
    if (!row) {
      // The row vanished between our insert and select (a concurrent clearFailures): put it back.
      await tx.insert(authAttempts).values({ key }).onConflictDoNothing();
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
        .where(eq(authAttempts.key, key));
      return { ok: true };
    }
    const expired = !!row.lockedUntil && row.lockedUntil <= now;
    const fails = (expired ? 0 : row.fails) + 1;
    const lockedUntil = fails >= MAX_FAILS ? new Date(now.getTime() + LOCK_SECONDS * 1000) : null;
    await tx.update(authAttempts).set({ fails, lockedUntil }).where(eq(authAttempts.key, key));
    // Only real wrong passwords count toward the global backstop (not refusals while locked).
    await bumpCounter(tx, GLOBAL_KEY, GLOBAL_WINDOW_SEC, now);
    if (lockedUntil) return { ok: false, reason: "locked", retryAfterSec: LOCK_SECONDS };
    return { ok: false, reason: "invalid" };
  });
}
