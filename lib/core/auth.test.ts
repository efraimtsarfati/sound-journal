import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../db/test-utils";
import {
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
