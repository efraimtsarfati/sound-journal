import { describe, expect, it } from "vitest";
import artistGenres from "./__fixtures__/artist-genres.json";
import recording from "./__fixtures__/recording.json";
import { isMbid, lookupArtistGenres, lookupRecording, MusicBrainzError } from "./musicbrainz";

const REC = "11111111-1111-4111-8111-111111111111";
const ART = "22222222-2222-4222-8222-222222222222";

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const fn = async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, headers: init?.headers });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return Object.assign(fn, { calls });
}
const deps = (f: ReturnType<typeof fakeFetch>) => ({ fetch: f, contact: "someone@example.test", minIntervalMs: 0 });

describe("lookupRecording", () => {
  it("reads title, ordered artists, earliest release and first-release year", async () => {
    const f = fakeFetch(200, recording);
    const r = await lookupRecording(REC.toUpperCase(), deps(f));
    expect(r).toEqual({
      mbid: REC,
      title: "Made Up Song",
      artists: [
        { mbid: ART, name: "Made Up Band" },
        { mbid: "33333333-3333-4333-8333-333333333333", name: "Guest Person" },
      ],
      album: "Original Album",
      year: 1986,
    });
    expect(f.calls[0].url).toContain(`/recording/${REC}?inc=artist-credits+releases&fmt=json`);
    expect(f.calls[0].headers?.["User-Agent"]).toContain("someone@example.test");
  });
  it("refuses a bad ID without a request, and maps 404, 503 and odd answers", async () => {
    const f = fakeFetch(200, recording);
    await expect(lookupRecording("nope", deps(f))).rejects.toMatchObject({ code: "invalid_id" });
    expect(f.calls).toHaveLength(0);
    await expect(lookupRecording(REC, deps(fakeFetch(404, {})))).rejects.toMatchObject({ code: "not_found" });
    await expect(lookupRecording(REC, deps(fakeFetch(503, {})))).rejects.toMatchObject({ code: "unavailable" });
    await expect(lookupRecording(REC, deps(fakeFetch(200, { id: "99999999-9999-4999-8999-999999999999", title: "x" })))).rejects.toBeInstanceOf(
      MusicBrainzError,
    );
  });
  it("fails closed without a contact, and on network errors", async () => {
    const prior = process.env.MUSICBRAINZ_CONTACT;
    delete process.env.MUSICBRAINZ_CONTACT;
    try {
      await expect(lookupRecording(REC, { fetch: fakeFetch(200, recording), minIntervalMs: 0 })).rejects.toMatchObject({ code: "not_configured" });
    } finally {
      if (prior !== undefined) process.env.MUSICBRAINZ_CONTACT = prior;
    }
    const boom = async () => {
      throw new Error("down");
    };
    await expect(lookupRecording(REC, { fetch: boom, contact: "a@b.test", minIntervalMs: 0 })).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("lookupArtistGenres", () => {
  it("lowercases names and keeps vote counts as weight", async () => {
    const g = await lookupArtistGenres(ART, deps(fakeFetch(200, artistGenres)));
    expect(g).toEqual([
      { genre: "post-punk", weight: 12 },
      { genre: "new wave", weight: 4 },
    ]);
  });
  it("returns an empty list when there are none", async () => {
    expect(await lookupArtistGenres(ART, deps(fakeFetch(200, { id: ART })))).toEqual([]);
  });
});

describe("isMbid", () => {
  it("accepts UUIDs only", () => {
    expect(isMbid(REC)).toBe(true);
    expect(isMbid("1234")).toBe(false);
  });
});
