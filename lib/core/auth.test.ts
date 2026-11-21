import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../db/test-utils";
import {
  GLOBAL_DELAY_MS,
  LOCK_SECONDS,
  LOGIN_KEY,
  MAX_FAILS,
  attemptLogin,
  clearFailures,
  lockRemainingSec,
  passwordMatches,
} from "./auth";
import { authAttempts, type Db } from "../db";
import { eq } from "drizzle-orm";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  const t = await createTestDb();
  db = t.db as unknown as Db;
  close = t.close;
});
afterAll(() => close());

describe("passwordMatches", () => {
  it("matches only the exact password", () => {
    expect(passwordMatches("pw", "pw")).toBe(true);
    expect(passwordMatches("pw", "pw ")).toBe(false);
    expect(passwordMatches(undefined, "")).toBe(false);
  });
});

describe("attemptLogin lockout", () => {
  beforeEach(() => clearFailures(db, LOGIN_KEY));

  const t0 = new Date("2026-01-01T00:00:00Z");

  it("locks after MAX_FAILS, refuses even the right password, then unlocks", async () => {
    for (let i = 1; i < MAX_FAILS; i++) {
      expect(await attemptLogin(db, "pw", "bad", t0)).toEqual({ ok: false, reason: "invalid" });
    }
    const locking = await attemptLogin(db, "pw", "bad", t0);
    expect(locking).toEqual({ ok: false, reason: "locked", retryAfterSec: LOCK_SECONDS });
    expect(await lockRemainingSec(db, LOGIN_KEY, t0)).toBe(LOCK_SECONDS);

    const during = new Date(t0.getTime() + 60_000);
    expect(await attemptLogin(db, "pw", "pw", during)).toMatchObject({ ok: false, reason: "locked" });

    const after = new Date(t0.getTime() + (LOCK_SECONDS + 1) * 1000);
    expect(await attemptLogin(db, "pw", "pw", after)).toEqual({ ok: true });
    expect(await lockRemainingSec(db, LOGIN_KEY, after)).toBe(0);
  });

  it("success resets the failure count", async () => {
    const now = new Date("2026-02-01T00:00:00Z");
    for (let i = 0; i < MAX_FAILS - 1; i++) await attemptLogin(db, "pw", "bad", now);
    expect(await attemptLogin(db, "pw", "pw", now)).toEqual({ ok: true });
    for (let i = 0; i < MAX_FAILS - 1; i++) {
      expect(await attemptLogin(db, "pw", "bad", now)).toMatchObject({ reason: "invalid" });
    }
  });

  it("an expired lock starts a fresh count", async () => {
    const now = new Date("2026-03-01T00:00:00Z");
    for (let i = 0; i < MAX_FAILS; i++) await attemptLogin(db, "pw", "bad", now);
    const later = new Date(now.getTime() + (LOCK_SECONDS + 1) * 1000);
    expect(await attemptLogin(db, "pw", "bad", later)).toEqual({ ok: false, reason: "invalid" });
  });

  it("fails closed when no password is configured", async () => {
    const now = new Date("2026-04-01T00:00:00Z");
    expect(await attemptLogin(db, undefined, "", now)).toMatchObject({ ok: false });
  });
});

describe("attemptLogin concurrency", () => {
  beforeEach(() => clearFailures(db, LOGIN_KEY));
  const now = new Date("2026-05-01T00:00:00Z");

  it("parallel wrong passwords cannot get more than MAX_FAILS guesses", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => attemptLogin(db, "pw", "bad", now)),
    );
    expect(results.filter((r) => !r.ok && r.reason === "invalid")).toHaveLength(MAX_FAILS - 1);
    expect(results.filter((r) => !r.ok && r.reason === "locked")).toHaveLength(8 - (MAX_FAILS - 1));
    const rows = await db.select().from(authAttempts).where(eq(authAttempts.key, LOGIN_KEY));
    expect(rows[0].fails).toBe(MAX_FAILS);
  });

  it("a locked key refuses the correct password without counting", async () => {
    for (let i = 0; i < MAX_FAILS; i++) await attemptLogin(db, "pw", "bad", now);
    expect(await attemptLogin(db, "pw", "pw", now)).toMatchObject({ ok: false, reason: "locked" });
    const rows = await db.select().from(authAttempts).where(eq(authAttempts.key, LOGIN_KEY));
    expect(rows[0].fails).toBe(MAX_FAILS);
  });
});

describe("attemptLogin row handling", () => {
  beforeEach(() => clearFailures(db, LOGIN_KEY));
  const now = new Date("2026-07-01T00:00:00Z");

  it("success keeps the row, with 0 fails and no lock", async () => {
    await attemptLogin(db, "pw", "bad", now);
    expect(await attemptLogin(db, "pw", "pw", now)).toEqual({ ok: true });
    const rows = await db.select().from(authAttempts).where(eq(authAttempts.key, LOGIN_KEY));
    expect(rows).toHaveLength(1);
    expect(rows[0].fails).toBe(0);
    expect(rows[0].lockedUntil).toBeNull();
  });

  it("concurrent successes and failures never throw", async () => {
    const results = await Promise.all([
      ...Array.from({ length: 6 }, () => attemptLogin(db, "pw", "pw", now)),
      ...Array.from({ length: 6 }, () => attemptLogin(db, "pw", "bad", now)),
      clearFailures(db, LOGIN_KEY),
      clearFailures(db, LOGIN_KEY),
    ]);
    expect(results.filter((r) => r && "ok" in r)).toHaveLength(12);
  });

  it("recreates a row that disappears mid-attempt", async () => {
    // Simulate a concurrent delete between the insert and the locking select.
    const racing = {
      ...db,
      select: db.select.bind(db),
      transaction: (fn: Parameters<Db["transaction"]>[0]) =>
        db.transaction(async (tx) => {
          const realSelect = tx.select.bind(tx);
          let first = true;
          (tx as unknown as { select: unknown }).select = (...a: unknown[]) => {
            const q = (realSelect as (...x: unknown[]) => { from: (t: unknown) => unknown })(...a);
            if (!first) return q;
            first = false;
            const from = q.from.bind(q);
            q.from = (t: unknown) => {
              const w = from(t) as { where: (c: unknown) => unknown };
              const where = w.where.bind(w);
              w.where = (c: unknown) => {
                const r = where(c) as { for: (m: string) => Promise<unknown[]> };
                r.for = async () => [];
                return r;
              };
              return w;
            };
            return q;
          };
          return fn(tx);
        }),
    } as unknown as Db;
    expect(await attemptLogin(racing, "pw", "pw", now)).toEqual({ ok: true });
  });
});

describe("per-IP lockout and the global backstop", () => {
  const now = new Date("2026-11-21T12:00:00Z");
  const sleeps: number[] = [];
  const sleep = async (ms: number) => void sleeps.push(ms);
  beforeEach(async () => {
    sleeps.length = 0;
    await db.delete(authAttempts);
  });

  it("locks one IP after 5 fails and leaves another IP free", async () => {
    for (let i = 0; i < MAX_FAILS; i++) await attemptLogin(db, "pw", "bad", now, { ip: "203.0.113.5", sleep });
    expect(await attemptLogin(db, "pw", "pw", now, { ip: "203.0.113.5", sleep })).toMatchObject({
      ok: false,
      reason: "locked",
    });
    expect(await attemptLogin(db, "pw", "pw", now, { ip: "203.0.113.9", sleep })).toEqual({ ok: true });
    expect(sleeps).toEqual([]);
  });

  it("after 50 wrong passwords in an hour every attempt is delayed, but the right password still works", async () => {
    for (let i = 0; i < 50; i++) {
      await attemptLogin(db, "pw", "bad", now, { ip: `198.51.100.${i}`, sleep });
    }
    expect(sleeps).toEqual([]);
    expect(await attemptLogin(db, "pw", "pw", now, { ip: "192.0.2.1", sleep })).toEqual({ ok: true });
    expect(sleeps).toEqual([GLOBAL_DELAY_MS]);
    // the next hour starts clean
    const later = new Date(now.getTime() + 3600_000);
    expect(await attemptLogin(db, "pw", "pw", later, { ip: "192.0.2.1", sleep })).toEqual({ ok: true });
    expect(sleeps).toEqual([GLOBAL_DELAY_MS]);
  });

  it("refusals while locked do not count toward the backstop", async () => {
    for (let i = 0; i < MAX_FAILS; i++) await attemptLogin(db, "pw", "bad", now, { ip: "203.0.113.5", sleep });
    for (let i = 0; i < 60; i++) await attemptLogin(db, "pw", "bad", now, { ip: "203.0.113.5", sleep });
    await attemptLogin(db, "pw", "pw", now, { ip: "203.0.113.7", sleep });
    expect(sleeps).toEqual([]);
  });
});
