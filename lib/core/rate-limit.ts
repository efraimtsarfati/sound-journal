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

/**
 * Outcome of counting one registration attempt. `retryAfterSec` is the time left in the current
 * window (at least 1), which is when the count starts again.
 */
export type RegistrationCheck = { allowed: boolean; retryAfterSec: number };

/** Whether this client IP may register another client (10 per hour); counts the attempt either way. */
export async function allowRegistration(db: DbOrTx, ip: string, now: Date = new Date()): Promise<RegistrationCheck> {
  const count = await bumpCounter(db, `register:ip:${ip}`, REGISTER_WINDOW_SEC, now);
  const { endsAt } = windowKey("", now, REGISTER_WINDOW_SEC);
  return { allowed: count <= REGISTER_LIMIT, retryAfterSec: Math.max(1, Math.ceil((endsAt.getTime() - now.getTime()) / 1000)) };
}

/** Expands an IPv6 address to its 8 groups, or null if it is not one. */
function ipv6Groups(v: string): number[] | null {
  if (!v.includes(":")) return null;
  const halves = v.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string) => (s === "" ? [] : s.split(":"));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const nums = all.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.length === 8 && nums.every((n) => !Number.isNaN(n)) ? nums : null;
}

/**
 * Normalizes a client IP for use in a key (bounded length, no surprises). An IPv6 address is
 * reduced to its /64 (the part one subscriber controls, so rotating the low bits does not dodge a
 * lockout), written as the first four groups followed by `::`. Calling it again on its own output
 * gives the same value.
 */
export function ipKeyPart(ip: string | undefined | null): string {
  const v = (ip ?? "").trim().toLowerCase().split("%")[0].replace(/[^0-9a-f:.]/g, "").slice(0, 45);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v);
  if (mapped) return mapped[1];
  const groups = ipv6Groups(v);
  if (groups) return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::`;
  return v || "unknown";
}
