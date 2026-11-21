import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  artists,
  authAttempts,
  entries,
  entrySources,
  highlightTags,
  highlights,
  oauthClients,
  oauthCodes,
  oauthGrants,
  oauthTokens,
  tags,
  type Db,
} from "../db";
import {
  createTestDb,
  insertArtist,
  insertEntry,
  insertHighlight,
  insertTag,
  insertUser,
} from "../db/test-utils";
import { cleanupExpiredAuth, purgeDeleted, runDailyCleanup } from "./cleanup";
import { OWNER_USER_ID } from "./owner";

const now = new Date("2026-08-01T00:00:00Z");
const daysAgo = (d: number, extraMs = 0) => new Date(now.getTime() - d * 86_400_000 - extraMs);

let t: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Db;
});
afterAll(() => t.close());

let n = 0;
async function entryWithHighlight(opts: { entryDeleted?: Date; highlightDeleted?: Date; userId?: string } = {}) {
  n++;
  const userId = opts.userId ?? OWNER_USER_ID;
  const entry = await insertEntry(t.db, { userId, title: `Song ${n}`, deletedAt: opts.entryDeleted ?? null });
  await t.db.insert(entrySources).values({
    entryId: entry.id,
    type: "youtube",
    externalId: `vid${n}`.padEnd(11, "x"),
    url: `https://youtu.be/vid${n}`,
  });
  const h = await insertHighlight(t.db, { entryId: entry.id, userId, deletedAt: opts.highlightDeleted ?? null });
  return { entry, h };
}

describe("purgeDeleted", () => {
  it("removes an entry deleted 31 days ago with its sources, highlights and tag links", async () => {
    const { entry, h } = await entryWithHighlight({ entryDeleted: daysAgo(31), highlightDeleted: daysAgo(31) });
    const tag = await insertTag(t.db, { name: "Purge Tag", slug: "purge-tag" });
    await t.db.insert(highlightTags).values({ highlightId: h.id, tagId: tag.id, addedBy: "agent" });
    const r = await purgeDeleted(db, OWNER_USER_ID, now);
    expect(r.entries).toBeGreaterThanOrEqual(1);
    expect(r.highlightIds).toContain(h.id);
    expect(await t.db.select().from(entries).where(eq(entries.id, entry.id))).toHaveLength(0);
    expect(await t.db.select().from(entrySources).where(eq(entrySources.entryId, entry.id))).toHaveLength(0);
    expect(await t.db.select().from(highlights).where(eq(highlights.id, h.id))).toHaveLength(0);
    expect(await t.db.select().from(highlightTags).where(eq(highlightTags.highlightId, h.id))).toHaveLength(0);
    expect(await t.db.select().from(tags).where(eq(tags.id, tag.id))).toHaveLength(1);
  });

  it("purges live highlights of an old deleted entry too", async () => {
    const { entry, h } = await entryWithHighlight({ entryDeleted: daysAgo(40) });
    const r = await purgeDeleted(db, OWNER_USER_ID, now);
    expect(r.highlightIds).toContain(h.id);
    expect(await t.db.select().from(entries).where(eq(entries.id, entry.id))).toHaveLength(0);
  });

  it("keeps entries deleted 29 days ago and exactly 30 days ago", async () => {
    const a = await entryWithHighlight({ entryDeleted: daysAgo(29), highlightDeleted: daysAgo(29) });
    const b = await entryWithHighlight({ entryDeleted: daysAgo(30), highlightDeleted: daysAgo(30) });
    await purgeDeleted(db, OWNER_USER_ID, now);
    expect(await t.db.select().from(entries).where(eq(entries.id, a.entry.id))).toHaveLength(1);
    expect(await t.db.select().from(entries).where(eq(entries.id, b.entry.id))).toHaveLength(1);
    expect(await t.db.select().from(highlights).where(eq(highlights.id, b.h.id))).toHaveLength(1);
    const c = await entryWithHighlight({ entryDeleted: daysAgo(30, 1), highlightDeleted: daysAgo(30, 1) });
    await purgeDeleted(db, OWNER_USER_ID, now);
    expect(await t.db.select().from(entries).where(eq(entries.id, c.entry.id))).toHaveLength(0);
  });

  it("removes an old deleted highlight on a live entry but keeps the entry and its live highlight", async () => {
    const { entry, h: live } = await entryWithHighlight();
    const old = await insertHighlight(t.db, { entryId: entry.id, deletedAt: daysAgo(35) });
    const recent = await insertHighlight(t.db, { entryId: entry.id, deletedAt: daysAgo(5) });
    const r = await purgeDeleted(db, OWNER_USER_ID, now);
    expect(r.highlightIds).toContain(old.id);
    expect(r.highlightIds).not.toContain(recent.id);
    expect(await t.db.select().from(highlights).where(eq(highlights.id, old.id))).toHaveLength(0);
    expect(await t.db.select().from(highlights).where(eq(highlights.id, recent.id))).toHaveLength(1);
    expect(await t.db.select().from(highlights).where(eq(highlights.id, live.id))).toHaveLength(1);
    expect(await t.db.select().from(entries).where(eq(entries.id, entry.id))).toHaveLength(1);
  });

  it("leaves live rows, tags and artists alone", async () => {
    const { entry, h } = await entryWithHighlight();
    const artist = await insertArtist(t.db, { name: "Kept Artist", nameNormalized: "kept artist" });
    await purgeDeleted(db, OWNER_USER_ID, now);
    expect(await t.db.select().from(entries).where(eq(entries.id, entry.id))).toHaveLength(1);
    expect(await t.db.select().from(highlights).where(eq(highlights.id, h.id))).toHaveLength(1);
    expect(await t.db.select().from(artists).where(eq(artists.id, artist.id))).toHaveLength(1);
  });

  it("is scoped to one user; the daily run purges all users", async () => {
    const other = await insertUser(t.db);
    const mine = await entryWithHighlight({ entryDeleted: daysAgo(60) });
    const theirs = await entryWithHighlight({ entryDeleted: daysAgo(60), userId: other.id });
    await purgeDeleted(db, OWNER_USER_ID, now);
    expect(await t.db.select().from(entries).where(eq(entries.id, mine.entry.id))).toHaveLength(0);
    expect(await t.db.select().from(entries).where(eq(entries.id, theirs.entry.id))).toHaveLength(1);
    const summary = await runDailyCleanup(db, now);
    expect(summary.purged.entries).toBe(1);
    expect(await t.db.select().from(entries).where(eq(entries.id, theirs.entry.id))).toHaveLength(0);
  });

  it("a second run finds nothing", async () => {
    await purgeDeleted(db, OWNER_USER_ID, now);
    expect(await purgeDeleted(db, OWNER_USER_ID, now)).toEqual({ entries: 0, highlights: 0, highlightIds: [] });
  });
});

describe("cleanupExpiredAuth", () => {
  const minutes = (m: number) => new Date(now.getTime() + m * 60_000);

  it("removes only what is dead", async () => {
    await t.db.insert(oauthClients).values([
      { id: "old-orphan", name: "o", redirectUris: ["https://x.test/cb"], createdAt: daysAgo(8) },
      { id: "new-orphan", name: "n", redirectUris: ["https://x.test/cb"], createdAt: daysAgo(1) },
      { id: "with-grant", name: "g", redirectUris: ["https://x.test/cb"], createdAt: daysAgo(30) },
      { id: "with-code", name: "c", redirectUris: ["https://x.test/cb"], createdAt: daysAgo(30) },
    ]);
    await t.db.insert(oauthCodes).values([
      { codeHash: "expired-code", clientId: "with-code", userId: OWNER_USER_ID, codeChallenge: "c", redirectUri: "r", expiresAt: minutes(-1) },
      { codeHash: "live-code", clientId: "with-code", userId: OWNER_USER_ID, codeChallenge: "c", redirectUri: "r", expiresAt: minutes(1) },
    ]);
    const [live] = await t.db.insert(oauthGrants).values({ clientId: "with-grant", userId: OWNER_USER_ID }).returning();
    const [dead] = await t.db.insert(oauthGrants).values({ clientId: "with-grant", userId: OWNER_USER_ID }).returning();
    await t.db.insert(oauthTokens).values([
      { tokenHash: "expired-access", grantId: live.id, kind: "access", expiresAt: minutes(-1) },
      { tokenHash: "live-access", grantId: live.id, kind: "access", expiresAt: minutes(30) },
      { tokenHash: "used-refresh", grantId: live.id, kind: "refresh", expiresAt: minutes(60), usedAt: minutes(-5) },
      { tokenHash: "dead-access", grantId: dead.id, kind: "access", expiresAt: minutes(-2) },
    ]);
    await t.db.insert(authAttempts).values({ key: "expired-lock", fails: 5, lockedUntil: minutes(-1) });
    await t.db.insert(authAttempts).values({ key: "live-lock", fails: 5, lockedUntil: minutes(5) });
    await t.db.insert(authAttempts).values({ key: "counting", fails: 2 });

    const r = await cleanupExpiredAuth(db, now);
    expect(r).toEqual({ codes: 1, tokens: 2, grants: 1, clients: 1, attempts: 1 });

    const ids = async (table: typeof oauthClients) => (await t.db.select().from(table)).map((c) => c.id).sort();
    expect(await ids(oauthClients)).toEqual(["new-orphan", "with-code", "with-grant"]);
    expect((await t.db.select().from(oauthCodes)).map((c) => c.codeHash)).toEqual(["live-code"]);
    expect((await t.db.select().from(oauthTokens)).map((x) => x.tokenHash).sort()).toEqual(["live-access", "used-refresh"]);
    expect((await t.db.select().from(oauthGrants)).map((g) => g.id)).toEqual([live.id]);
    expect((await t.db.select().from(authAttempts)).map((a) => a.key).sort()).toEqual(["counting", "live-lock"]);

    expect(await cleanupExpiredAuth(db, now)).toEqual({ codes: 0, tokens: 0, grants: 0, clients: 0, attempts: 0 });
  });
});
