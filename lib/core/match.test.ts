import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { artistGenres, artists, entries, entryArtists, highlights } from "../db";
import { createTestDb, insertArtist, insertEntry, insertHighlight, insertUser } from "../db/test-utils";
import { confirmMatch, matchEntry, rejectMatchCandidate } from "./match";
import { OWNER_USER_ID } from "./owner";
import recording from "../metadata/__fixtures__/recording.json";
import genresFixture from "../metadata/__fixtures__/artist-genres.json";

const REC = "11111111-1111-4111-8111-111111111111";
const BAND = "22222222-2222-4222-8222-222222222222";
const GUEST = "33333333-3333-4333-8333-333333333333";

let t: Awaited<ReturnType<typeof createTestDb>>;
let db!: Awaited<ReturnType<typeof createTestDb>>["db"];
beforeAll(async () => {
  t = await createTestDb();
  db = t.db;
});
afterAll(() => t.close());

let requests: string[] = [];
let genresDown = false;
const mb = {
  contact: "x@example.test",
  minIntervalMs: 0,
  fetch: async (url: string) => {
    requests.push(url);
    if (url.includes("/recording/")) {
      return url.includes(REC) ? { ok: true, status: 200, json: async () => recording } : { ok: false, status: 404, json: async () => ({}) };
    }
    if (genresDown) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => (url.includes(BAND) ? genresFixture : { genres: [] }) };
  },
};

const D = () => t.db as never;
async function seed(over: Parameters<typeof insertEntry>[1] = {}) {
  requests = [];
  genresDown = false;
  const e = await insertEntry(db, { title: "raw title (official video)", ...over });
  await insertHighlight(db, { entryId: e.id, userId: OWNER_USER_ID, note: "x", status: "tagged" });
  return e;
}
const reload = async (id: string) => (await db.select().from(entries).where(eq(entries.id, id)))[0];

describe("matchEntry high confidence", () => {
  it("applies title, album, year, artists in order and genres; flags highlights for search", async () => {
    const e = await seed({ album: "Old Album" });
    const oldArtist = await insertArtist(db, { name: "made up band", nameNormalized: "made up band" });
    await db.insert(entryArtists).values({ entryId: e.id, artistId: oldArtist.id, role: "primary", position: 0 });
    await db.update(highlights).set({ searchDirty: false }).where(eq(highlights.entryId, e.id));

    const r = await matchEntry(D(), OWNER_USER_ID, { entryId: e.id, mbid: REC, confidence: "high" }, mb);
    expect(r.outcome).toBe("matched");
    const row = await reload(e.id);
    expect(row).toMatchObject({ matchStatus: "matched", mbid: REC, mbidCandidate: null, title: "Made Up Song", album: "Original Album", originalReleaseYear: 1986 });

    const links = await db.select({ name: artists.name, mbid: artists.mbid, id: artists.id, pos: entryArtists.position }).from(entryArtists).innerJoin(artists, eq(artists.id, entryArtists.artistId)).where(eq(entryArtists.entryId, e.id)).orderBy(entryArtists.position);
    expect(links.map((l) => [l.name, l.mbid])).toEqual([["Made Up Band", BAND], ["Guest Person", GUEST]]);
    expect(links[0].id).toBe(oldArtist.id); // the MBID-less row was adopted, not duplicated

    const g = await db.select().from(artistGenres).where(eq(artistGenres.artistId, oldArtist.id));
    expect(g.map((x) => x.genre).sort()).toEqual(["new wave", "post-punk"]);
    expect(g.every((x) => x.source === "musicbrainz")).toBe(true);
    const hl = await db.select().from(highlights).where(eq(highlights.entryId, e.id));
    expect(hl[0].searchDirty).toBe(true);
  });

  it("reuses an artist that already has the MBID and skips fresh genres", async () => {
    const first = await seed();
    await matchEntry(D(), OWNER_USER_ID, { entryId: first.id, mbid: REC, confidence: "high" }, mb);
    const second = await seed();
    await matchEntry(D(), OWNER_USER_ID, { entryId: second.id, mbid: REC, confidence: "high" }, mb);
    expect(requests.filter((u) => u.includes(`/artist/${BAND}`))).toHaveLength(0);
    const rows = await db.select().from(artists).where(eq(artists.mbid, BAND));
    expect(rows).toHaveLength(1);
  });

  it("still matches when genres cannot be fetched", async () => {
    const e = await seed();
    await db.delete(artistGenres);
    genresDown = true;
    const r = await matchEntry(D(), OWNER_USER_ID, { entryId: e.id, mbid: REC, confidence: "high" }, mb);
    expect(r.entry.matchStatus).toBe("matched");
  });

  it("keeps album and year when MusicBrainz has none", async () => {
    const e = await seed({ album: "Mine", originalReleaseYear: 1999 });
    const noExtras = { ...mb, fetch: async (url: string) => (url.includes("/recording/") ? { ok: true, status: 200, json: async () => ({ id: REC, title: "T", "artist-credit": [], releases: [] }) } : mb.fetch(url)) };
    await matchEntry(D(), OWNER_USER_ID, { entryId: e.id, mbid: REC, confidence: "high" }, noExtras);
    expect(await reload(e.id)).toMatchObject({ album: "Mine", originalReleaseYear: 1999, title: "T" });
  });

  it("refuses an unknown MBID and changes nothing", async () => {
    const e = await seed();
    await expect(matchEntry(D(), OWNER_USER_ID, { entryId: e.id, mbid: "99999999-9999-4999-8999-999999999999", confidence: "high" }, mb)).rejects.toMatchObject({ code: "not_found" });
    expect(await reload(e.id)).toMatchObject({ matchStatus: "unmatched", mbid: null, title: "raw title (official video)" });
  });

  it("is scoped to the user and ignores deleted entries", async () => {
    const other = await insertUser(db, { displayName: "Other" });
    const theirs = await insertEntry(db, { userId: other.id, title: "Theirs" });
    await expect(matchEntry(D(), OWNER_USER_ID, { entryId: theirs.id, mbid: REC, confidence: "high" }, mb)).rejects.toMatchObject({ code: "not_found" });
    const gone = await insertEntry(db, { title: "Gone", deletedAt: new Date() });
    await expect(matchEntry(D(), OWNER_USER_ID, { entryId: gone.id, mbid: REC, confidence: "high" }, mb)).rejects.toMatchObject({ code: "not_found" });
    expect((await reload(theirs.id)).mbid).toBeNull();
  });
});

describe("low confidence, confirm and reject", () => {
  it("low stores only a candidate; confirm applies it as confirmed", async () => {
    const e = await seed();
    const r = await matchEntry(D(), OWNER_USER_ID, { entryId: e.id, mbid: REC, confidence: "low" }, mb);
    expect(r.outcome).toBe("candidate");
    expect(await reload(e.id)).toMatchObject({ matchStatus: "unmatched", mbid: null, mbidCandidate: REC, title: "raw title (official video)" });
    expect(requests.some((u) => u.includes("/artist/"))).toBe(false);

    const c = await confirmMatch(D(), OWNER_USER_ID, e.id, mb);
    expect(c.outcome).toBe("confirmed");
    expect(await reload(e.id)).toMatchObject({ matchStatus: "confirmed", mbid: REC, mbidCandidate: null, title: "Made Up Song" });
  });

  it("confirm without a candidate is refused; reject clears the candidate", async () => {
    const e = await seed();
    await expect(confirmMatch(D(), OWNER_USER_ID, e.id, mb)).rejects.toMatchObject({ code: "invalid_state" });
    await matchEntry(D(), OWNER_USER_ID, { entryId: e.id, mbid: REC, confidence: "low" }, mb);
    await rejectMatchCandidate(D(), OWNER_USER_ID, e.id);
    expect(await reload(e.id)).toMatchObject({ matchStatus: "unmatched", mbidCandidate: null });
  });

  it("a low-confidence call cannot downgrade a matched entry", async () => {
    const e = await seed();
    await matchEntry(D(), OWNER_USER_ID, { entryId: e.id, mbid: REC, confidence: "high" }, mb);
    await expect(matchEntry(D(), OWNER_USER_ID, { entryId: e.id, mbid: REC, confidence: "low" }, mb)).rejects.toMatchObject({ code: "invalid_state" });
    expect((await reload(e.id)).matchStatus).toBe("matched");
  });

  it("another user cannot confirm or reject", async () => {
    const other = await insertUser(db, { displayName: "Other2" });
    const theirs = await insertEntry(db, { userId: other.id, title: "T", mbidCandidate: REC });
    await expect(confirmMatch(D(), OWNER_USER_ID, theirs.id, mb)).rejects.toMatchObject({ code: "not_found" });
    await expect(rejectMatchCandidate(D(), OWNER_USER_ID, theirs.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await reload(theirs.id)).mbidCandidate).toBe(REC);
    void and;
  });
});

describe("confirmed matches are protected", () => {
  it("refuses high and low calls on a confirmed entry until the owner rejects the match", async () => {
    const e = await seed();
    await matchEntry(D(), OWNER_USER_ID, { entryId: e.id, mbid: REC, confidence: "low" }, mb);
    await confirmMatch(D(), OWNER_USER_ID, e.id, mb);
    for (const confidence of ["high", "low"] as const) {
      await expect(matchEntry(D(), OWNER_USER_ID, { entryId: e.id, mbid: REC, confidence }, mb)).rejects.toThrow(/reject the match in the app/);
    }
    expect(await reload(e.id)).toMatchObject({ matchStatus: "confirmed", mbid: REC });
    await rejectMatchCandidate(D(), OWNER_USER_ID, e.id);
    expect(await reload(e.id)).toMatchObject({ matchStatus: "unmatched", mbid: null, mbidCandidate: null });
    const r = await matchEntry(D(), OWNER_USER_ID, { entryId: e.id, mbid: REC, confidence: "high" }, mb);
    expect(r.outcome).toBe("matched");
  });
});
