import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { entries, type Db } from "../db";
import { createTestDb, insertEntry } from "../db/test-utils";
import recording from "../metadata/__fixtures__/recording.json";
import { handleConfirmMatch, handleRejectMatch } from "./match-routes";

const ORIGIN = "https://journal.example.test";
const ENV = { APP_ORIGIN: ORIGIN };
const REC = "11111111-1111-4111-8111-111111111111";
const mb = {
  contact: "x@example.test",
  minIntervalMs: 0,
  fetch: async (url: string) => ({ ok: true, status: 200, json: async () => (url.includes("/recording/") ? recording : { genres: [] }) }),
};

let t: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Db;
});
afterAll(() => t.close());

const req = (headers: Record<string, string> = {}) => new Request(`${ORIGIN}/api/x`, { method: "POST", headers });

describe("match routes", () => {
  it("confirms a candidate", async () => {
    const e = await insertEntry(t.db, { mbidCandidate: REC });
    const res = await handleConfirmMatch(req(), e.id, db, ENV, mb);
    expect(res.status).toBe(200);
    expect((await res.json()).matchStatus).toBe("confirmed");
    expect((await t.db.select().from(entries).where(eq(entries.id, e.id)))[0].title).toBe("Made Up Song");
  });
  it("rejects a candidate", async () => {
    const e = await insertEntry(t.db, { mbidCandidate: REC });
    const res = await handleRejectMatch(req(), e.id, db, ENV);
    expect(res.status).toBe(200);
    expect((await t.db.select().from(entries).where(eq(entries.id, e.id)))[0].mbidCandidate).toBeNull();
  });
  it("refuses cross-origin, bad ids, missing candidates and unknown entries", async () => {
    const e = await insertEntry(t.db);
    expect((await handleConfirmMatch(req({ origin: "https://evil.test" }), e.id, db, ENV, mb)).status).toBe(403);
    expect((await handleConfirmMatch(req(), "nope", db, ENV, mb)).status).toBe(400);
    expect((await handleConfirmMatch(req(), e.id, db, ENV, mb)).status).toBe(409);
    expect((await handleRejectMatch(req(), "99999999-9999-4999-8999-999999999999", db, ENV)).status).toBe(404);
  });
});
