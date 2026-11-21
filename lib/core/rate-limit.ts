import { eq, sql } from "drizzle-orm";
import { authAttempts, type DbOrTx } from "../db";

/**
 * Fixed-window counters kept in `auth_attempts` (no schema change): the key carries the window
 * number and `locked_until` holds the window's end purely so the daily cleanup deletes old rows.
 * The counters are never read as locks.
 */
function windowKey(prefix: string, now: Date, windowSec: number): { key: string; endsAt: Date } {
  const n = Math.floor(now.getTime() / 1000 / windowSec);
  return { key: `${prefix}:${n}`, endsAt: new Date((n + 1) * windowSec * 1000) };
}

/** Adds one to the counter for this window and returns the new count (atomic upsert). */
export async function bumpCounter(db: DbOrTx, prefix: string, windowSec: number, now: Date = new Date()): Promise<number> {
  const { key, endsAt } = windowKey(prefix, now, windowSec);
  const [row] = await db
    .insert(authAttempts)
    .values({ key, fails: 1, lockedUntil: endsAt })
    .onConflictDoUpdate({ target: authAttempts.key, set: { fails: sql`${authAttempts.fails} + 1` } })
    .returning({ fails: authAttempts.fails });
  return row.fails;
}

/** The current count for this window (0 when nothing was counted). */
export async function readCounter(db: DbOrTx, prefix: string, windowSec: number, now: Date = new Date()): Promise<number> {
  const { key } = windowKey(prefix, now, windowSec);
  const [row] = await db.select({ fails: authAttempts.fails }).from(authAttempts).where(eq(authAttempts.key, key));
  return row?.fails ?? 0;
}

export const REGISTER_LIMIT = 10;
export const REGISTER_WINDOW_SEC = 3600;

/** True when this client IP may register another client (10 per hour); counts the attempt either way. */
export async function allowRegistration(db: DbOrTx, ip: string, now: Date = new Date()): Promise<boolean> {
  const count = await bumpCounter(db, `register:ip:${ip}`, REGISTER_WINDOW_SEC, now);
  return count <= REGISTER_LIMIT;
}

/** Normalizes a client IP for use in a key (bounded length, no surprises). */
export function ipKeyPart(ip: string | undefined | null): string {
  const v = (ip ?? "").trim().toLowerCase().replace(/[^0-9a-f:.]/g, "").slice(0, 45);
  return v || "unknown";
}
