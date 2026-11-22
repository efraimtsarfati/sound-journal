import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { highlights, type Db } from "../db";
import { createTestDb, insertUser } from "../db/test-utils";
import { FakeVectorIndex } from "../search";
import { searchHighlights } from "./agent-read";
import { runDailyCleanup } from "./cleanup";
import { addEntry, softDeleteEntry } from "./entries";
import { addHighlight, softDeleteHighlight } from "./highlights";
import { OWNER_USER_ID } from "./owner";
import { listEntriesByMeaning, resyncSearch, syncDirtyHighlights, syncSearchQuietly, vectorText } from "./search";
import { setHighlightTags } from "./tags";

let t: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
let n = 0;
beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Db;
});
afterAll(() => t.close());

async function save(note: string | null, title = "Made Up Song", userId = OWNER_USER_ID) {
  const r = await addEntry(db, userId, {
    title,
    source: { type: "youtube", externalId: `sv${++n}`, url: "https://youtu.be/x" },
    highlight: { note },
  });
  if (r.duplicate) throw new Error("dup");
  return r;
}
const dirty = async (id: string) => (await db.select().from(highlights).where(eq(highlights.id, id)))[0].searchDirty;
const GHOST = "00000000-0000-4000-8000-0000000000ff";
const meta = (userId: string) => ({ user_id: userId, entry_id: "x", status: "needs_tags", captured_at: "" });

describe("vectorText", () => {
  it("follows the documented shape", () => {
    expect(vectorText("Song", ["A", "B"], "two guitars", ["Weaving"])).toBe("Song — A, B. two guitars. Tags: Weaving");
    expect(vectorText("Song", [], null, [])).toBe("Song — . . Tags: ");
  });
});

describe("syncDirtyHighlights", () => {
  it("upserts note, title and tags, then clears the flag", async () => {
    const r = await save("guitars weaving around each other");
    await setHighlightTags(db, OWNER_USER_ID, r.highlight.id, [{ name: "Interlocking", axis: "sound" }]);
    const index = new FakeVectorIndex();
    const out = await syncDirtyHighlights(db, index, OWNER_USER_ID, 1000);
    expect(out.upserted).toBeGreaterThanOrEqual(1);
    const doc = index.docs.get(r.highlight.id)!;
    expect(doc.text).toContain("guitars weaving");
    expect(doc.text).toContain("Tags: interlocking");
    expect(doc.metadata.user_id).toBe(OWNER_USER_ID);
    expect(doc.metadata.entry_id).toBe(r.entry.id);
    expect(await dirty(r.highlight.id)).toBe(false);
  });

  it("keeps the flag set when the index fails", async () => {
    const r = await save("a note");
    const index = new FakeVectorIndex();
    index.failUpserts = true;
    await expect(syncDirtyHighlights(db, index, OWNER_USER_ID, 1000)).rejects.toThrow();
    expect(await dirty(r.highlight.id)).toBe(true);
    await syncSearchQuietly(db, OWNER_USER_ID, index); // does not throw
    expect(await dirty(r.highlight.id)).toBe(true);
    index.failUpserts = false;
    await resyncSearch(db, index, OWNER_USER_ID);
    expect(await dirty(r.highlight.id)).toBe(false);
  });

  it("removes vectors of soft-deleted highlights and entries", async () => {
    const r = await save("first");
    const h2 = await addHighlight(db, OWNER_USER_ID, r.entry.id, { note: "second" });
    const index = new FakeVectorIndex();
    await syncDirtyHighlights(db, index, OWNER_USER_ID, 1000);
    expect(index.docs.has(h2.id)).toBe(true);
    await softDeleteHighlight(db, OWNER_USER_ID, h2.id);
    await syncDirtyHighlights(db, index, OWNER_USER_ID, 1000);
    expect(index.docs.has(h2.id)).toBe(false);
    expect(index.docs.has(r.highlight.id)).toBe(true);
    await softDeleteEntry(db, OWNER_USER_ID, r.entry.id);
    await syncDirtyHighlights(db, index, OWNER_USER_ID, 1000);
    expect(index.docs.has(r.highlight.id)).toBe(false);
  });

  it("only touches the given user's rows", async () => {
    const other = await insertUser(t.db);
    const mine = await save("mine");
    const theirs = await save("theirs", "Other Song", other.id);
    const index = new FakeVectorIndex();
    await syncDirtyHighlights(db, index, other.id, 1000);
    expect(index.docs.has(theirs.highlight.id)).toBe(true);
    expect(index.docs.has(mine.highlight.id)).toBe(false);
  });
});

describe("resyncSearch", () => {
  it("rebuilds an empty index and sweeps vectors with no live highlight", async () => {
    const r = await save("rebuild me");
    const index = new FakeVectorIndex();
    index.docs.set(GHOST, { id: GHOST, text: "ghost", metadata: meta(OWNER_USER_ID) });
    const out = await resyncSearch(db, index, OWNER_USER_ID);
    expect(out.orphans).toBe(1);
    expect(index.docs.has(GHOST)).toBe(false);
    expect(index.docs.has(r.highlight.id)).toBe(true);
    // The index is derived: wiping it and marking rows dirty rebuilds it from Postgres alone.
    index.docs.clear();
    await db.update(highlights).set({ searchDirty: true });
    await resyncSearch(db, index, OWNER_USER_ID);
    expect(index.docs.has(r.highlight.id)).toBe(true);
  });

  it("leaves another user's vectors alone when scoped", async () => {
    const index = new FakeVectorIndex();
    index.docs.set(GHOST, { id: GHOST, text: "x", metadata: meta("someone-else") });
    await resyncSearch(db, index, OWNER_USER_ID);
    expect(index.docs.has(GHOST)).toBe(true);
  });
});

describe("meaning search", () => {
  it("ranks by the index, returns scores and applies other filters", async () => {
    const a = await save("shimmering reverb pad", "Alpha");
    const b = await save("punchy drum break", "Beta");
    const index = new FakeVectorIndex();
    await resyncSearch(db, index, OWNER_USER_ID);
    const res = await searchHighlights(db, OWNER_USER_ID, { query: "reverb pad" }, index);
    expect(res.map((h) => h.id)).toEqual([a.highlight.id]);
    expect(res[0].score).toBeGreaterThan(0);
    expect(await searchHighlights(db, OWNER_USER_ID, { query: "reverb pad", status: "tagged" }, index)).toEqual([]);
    const found = await listEntriesByMeaning(db, index, OWNER_USER_ID, "drum break");
    expect(found.map((e) => e.entry.id)).toEqual([b.entry.id]);
  });

  it("never returns another user's highlights", async () => {
    const other = await insertUser(t.db);
    const theirs = await save("secret zebra sound", "Theirs", other.id);
    const index = new FakeVectorIndex();
    await resyncSearch(db, index);
    expect(await searchHighlights(db, OWNER_USER_ID, { query: "zebra" }, index)).toEqual([]);
    const own = await searchHighlights(db, other.id, { query: "zebra" }, index);
    expect(own.map((h) => h.id)).toEqual([theirs.highlight.id]);
  });

  it("uses a note substring match without an index", async () => {
    const r = await save("floating together");
    const res = await searchHighlights(db, OWNER_USER_ID, { query: "floating" }, null);
    expect(res.map((h) => h.id)).toContain(r.highlight.id);
  });

  it("falls back to a note match when the index errors", async () => {
    const r = await save("fallback phrase");
    const broken = new FakeVectorIndex();
    broken.query = async () => {
      throw new Error("down");
    };
    const res = await searchHighlights(db, OWNER_USER_ID, { query: "fallback phrase" }, broken);
    expect(res.map((h) => h.id)).toContain(r.highlight.id);
  });
});

describe("purge deletes vectors", () => {
  it("removes the vectors of purged highlights", async () => {
    const r = await save("old");
    const index = new FakeVectorIndex();
    await softDeleteEntry(db, OWNER_USER_ID, r.entry.id);
    index.docs.set(r.highlight.id, { id: r.highlight.id, text: "old", metadata: meta(OWNER_USER_ID) });
    await runDailyCleanup(db, new Date(Date.now() + 31 * 86_400_000), index);
    expect(index.docs.has(r.highlight.id)).toBe(false);
  });
});
