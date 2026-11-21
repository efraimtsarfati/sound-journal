import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "../db/test-utils";
import { lookupYouTube } from "./capture";
import { addEntry } from "./entries";
import { OWNER_USER_ID } from "./owner";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

const okFetch = (title: string, author: string) => async () => ({
  ok: true,
  status: 200,
  json: async () => ({ title, author_name: author }),
});
const statusFetch = (status: number) => async () => ({ ok: false, status, json: async () => ({}) });

describe("lookupYouTube", () => {
  it("rejects a link that isn't YouTube", async () => {
    const r = await lookupYouTube(t.db, OWNER_USER_ID, "https://example.com/x", { fetch: okFetch("a", "b") });
    expect(r).toMatchObject({ ok: false, error: "invalid_url" });
  });

  it("derives title and artist and carries the t= start", async () => {
    const r = await lookupYouTube(t.db, OWNER_USER_ID, "https://youtu.be/aaaaaaaaaa1?t=75", {
      fetch: okFetch("Some Band - Made Up Song (Official Video)", "SomeBandVEVO"),
    });
    expect(r).toMatchObject({
      ok: true,
      videoId: "aaaaaaaaaa1",
      startSec: 75,
      embeddable: true,
      title: "Made Up Song",
      artist: "Some Band",
      rawChannel: "SomeBandVEVO",
      duplicate: null,
    });
  });

  it("falls back to link-out with an empty title when oEmbed refuses", async () => {
    const r = await lookupYouTube(t.db, OWNER_USER_ID, "https://youtu.be/aaaaaaaaaa2", { fetch: statusFetch(401) });
    expect(r).toMatchObject({ ok: true, embeddable: false, title: "", rawTitle: null });
  });

  it("reports not_found and unavailable", async () => {
    expect(await lookupYouTube(t.db, OWNER_USER_ID, "https://youtu.be/aaaaaaaaaa3", { fetch: statusFetch(404) })).toMatchObject({
      ok: false,
      error: "not_found",
    });
    expect(await lookupYouTube(t.db, OWNER_USER_ID, "https://youtu.be/aaaaaaaaaa3", { fetch: statusFetch(500) })).toMatchObject({
      ok: false,
      error: "unavailable",
    });
  });

  it("flags an already-saved video", async () => {
    await addEntry(t.db, OWNER_USER_ID, {
      title: "Existing Song",
      source: { type: "youtube", externalId: "aaaaaaaaaa4", url: "https://www.youtube.com/watch?v=aaaaaaaaaa4" },
    });
    const r = await lookupYouTube(t.db, OWNER_USER_ID, "https://youtu.be/aaaaaaaaaa4", { fetch: okFetch("x", "y") });
    expect(r).toMatchObject({ ok: true, duplicate: { title: "Existing Song" } });
  });
});
