import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OWNER_USER_ID, addEntry } from "../core";
import type { Db } from "../db";
import { createTestDb } from "../db/test-utils";
import { handleAddHighlight, handleUpdateHighlight } from "./highlight-routes";

const ORIGIN = "https://journal.example.test";
const ENV = { APP_ORIGIN: ORIGIN };

let t: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Db;
});
afterAll(() => t.close());

const req = (body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
  new Request(`${ORIGIN}/api/x`, { method: "POST", headers, body: JSON.stringify(body) });

async function seed(videoId: string, note: string | null) {
  const r = await addEntry(db, OWNER_USER_ID, {
    title: "Song",
    source: { type: "youtube", externalId: videoId, url: `https://www.youtube.com/watch?v=${videoId}`, rawTitle: null, rawAuthor: null },
    highlight: { startSec: 10, endSec: null, note },
  });
  if (r.duplicate) throw new Error("dup");
  return r;
}

describe("handleUpdateHighlight", () => {
  it("adds a why: needs_why -> needs_tags", async () => {
    const r = await seed("aaaaaaaaaa1", null);
    expect(r.highlight.status).toBe("needs_why");
    const res = await handleUpdateHighlight(req({ note: "guitars weave" }), r.highlight.id, db, ENV);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("needs_tags");
  });
  it("changes times only and keeps the status", async () => {
    const r = await seed("aaaaaaaaaa2", "a note");
    const res = await handleUpdateHighlight(req({ startSec: 20, endSec: 30 }), r.highlight.id, db, ENV);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("needs_tags");
  });
  it("clearing the note returns to needs_why", async () => {
    const r = await seed("aaaaaaaaaa3", "a note");
    const res = await handleUpdateHighlight(req({ note: "  " }), r.highlight.id, db, ENV);
    expect((await res.json()).status).toBe("needs_why");
  });
  it("refuses bad times, unknown fields, bad ids, cross-origin and non-JSON", async () => {
    const r = await seed("aaaaaaaaaa4", null);
    expect((await handleUpdateHighlight(req({ startSec: 30, endSec: 20 }), r.highlight.id, db, ENV)).status).toBe(400);
    expect((await handleUpdateHighlight(req({ other: 1 }), r.highlight.id, db, ENV)).status).toBe(400);
    expect((await handleUpdateHighlight(req({ note: "x" }), "nope", db, ENV)).status).toBe(400);
    expect((await handleUpdateHighlight(req({ note: "x" }, { "content-type": "application/json", origin: "https://evil.test" }), r.highlight.id, db, ENV)).status).toBe(403);
    expect((await handleUpdateHighlight(req({ note: "x" }, { "content-type": "text/plain" }), r.highlight.id, db, ENV)).status).toBe(415);
  });
  it("404s for an unknown highlight", async () => {
    const res = await handleUpdateHighlight(req({ note: "x" }), "00000000-0000-4000-8000-000000000000", db, ENV);
    expect(res.status).toBe(404);
  });
});

describe("handleAddHighlight", () => {
  it("adds a clip with no note as needs_why, and with a note as needs_tags", async () => {
    const r = await seed("aaaaaaaaaa5", "first");
    const a = await handleAddHighlight(req({ startSec: 40 }), r.entry.id, db, ENV);
    expect((await a.json()).status).toBe("needs_why");
    const b = await handleAddHighlight(req({ startSec: 50, endSec: 60, note: "second" }), r.entry.id, db, ENV);
    expect((await b.json()).status).toBe("needs_tags");
  });
  it("404s for an unknown entry and 400s for an end without a start", async () => {
    expect((await handleAddHighlight(req({}), "00000000-0000-4000-8000-000000000000", db, ENV)).status).toBe(404);
    const r = await seed("aaaaaaaaaa6", null);
    expect((await handleAddHighlight(req({ endSec: 5 }), r.entry.id, db, ENV)).status).toBe(400);
  });
});
