import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { entryArtists } from "../db";
import { createTestDb, insertArtist, insertUser } from "../db/test-utils";
import { exportAll, getEntry, inboxCounts, listApprovedTags, listDeletedEntries, listEntries, listProposedTags } from "./browse";
import { addEntry, softDeleteEntry } from "./entries";
import { addHighlight, softDeleteHighlight } from "./highlights";
import { OWNER_USER_ID } from "./owner";
import { moveDeletedHighlightsToLiveEntry, restoreEntry } from "./restore";
import { approveTag, rejectTag, setHighlightTags } from "./tags";

let t: Awaited<ReturnType<typeof createTestDb>>;
let n = 0;
const src = (id = `br${++n}`) => ({ type: "youtube" as const, externalId: id, url: `https://youtu.be/${id}` });

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

async function entry(title: string, highlight?: { note?: string | null; startSec?: number }, id?: string) {
  const r = await addEntry(t.db, OWNER_USER_ID, { title, source: src(id), highlight });
  if (r.duplicate) throw new Error("unexpected duplicate");
  return r;
}

describe("browse", () => {
  it("lists live entries newest first with highlights, tags and artists", async () => {
    const a = await entry("First Made Up", { note: "warm bass" });
    const b = await entry("Second Made Up");
    await setHighlightTags(t.db, OWNER_USER_ID, a.highlight.id, [{ name: "warm bass", axis: "sound" }]);
    const artist = await insertArtist(t.db, { name: "Made Up Band", nameNormalized: "made up band" });
    await t.db.insert(entryArtists).values({ entryId: a.entry.id, artistId: artist.id, role: "primary" });

    const list = await listEntries(t.db, OWNER_USER_ID);
    const ids = list.map((v) => v.entry.id);
    expect(ids.indexOf(b.entry.id)).toBeLessThan(ids.indexOf(a.entry.id));
    const view = list.find((v) => v.entry.id === a.entry.id)!;
    expect(view.artists).toEqual(["Made Up Band"]);
    expect(view.highlights[0].tags.map((x) => x.name)).toEqual(["warm bass"]);
    expect(view.source?.externalId).toBe(a.source.externalId);
  });

  it("is scoped to the user and hides deleted entries and highlights", async () => {
    const other = await insertUser(t.db);
    const e = await entry("Scoped Made Up", { note: "x" });
    await addHighlight(t.db, OWNER_USER_ID, e.entry.id, { startSec: 30 });
    const second = (await getEntry(t.db, OWNER_USER_ID, e.entry.id))!.highlights.find((h) => h.startSec === 30)!;
    await softDeleteHighlight(t.db, OWNER_USER_ID, second.id);
    expect((await getEntry(t.db, OWNER_USER_ID, e.entry.id))!.highlights).toHaveLength(1);
    expect(await getEntry(t.db, other.id, e.entry.id)).toBeNull();
    expect(await listEntries(t.db, other.id)).toEqual([]);
    await softDeleteEntry(t.db, OWNER_USER_ID, e.entry.id);
    expect(await getEntry(t.db, OWNER_USER_ID, e.entry.id)).toBeNull();
  });

  it("counts inbox highlights by status, ignoring deleted ones", async () => {
    const before = await inboxCounts(t.db, OWNER_USER_ID);
    const e = await entry("Inbox Made Up");
    await addHighlight(t.db, OWNER_USER_ID, e.entry.id, { note: "has a why" });
    let after = await inboxCounts(t.db, OWNER_USER_ID);
    expect(after.needsWhy).toBe(before.needsWhy + 1);
    expect(after.needsTags).toBe(before.needsTags + 1);
    await softDeleteEntry(t.db, OWNER_USER_ID, e.entry.id);
    after = await inboxCounts(t.db, OWNER_USER_ID);
    expect(after).toEqual(before);
  });

  it("lists proposed tags with usage, and drops them once decided", async () => {
    const e = await entry("Tags Made Up", { note: "bright and wide" });
    await setHighlightTags(t.db, OWNER_USER_ID, e.highlight.id, [
      { name: "bright wide", axis: "sound" },
      { name: "kept proposal", axis: "sound" },
    ]);
    const proposed = await listProposedTags(t.db, OWNER_USER_ID);
    const bright = proposed.find((p) => p.name === "bright wide")!;
    expect(bright.uses).toBe(1);
    await approveTag(t.db, OWNER_USER_ID, bright.id);
    const kept = proposed.find((p) => p.name === "kept proposal")!;
    await rejectTag(t.db, OWNER_USER_ID, kept.id);
    const after = await listProposedTags(t.db, OWNER_USER_ID);
    expect(after.find((p) => p.id === bright.id)).toBeUndefined();
    expect(after.find((p) => p.id === kept.id)).toBeUndefined();
    expect((await listApprovedTags(t.db, OWNER_USER_ID)).some((x) => x.id === bright.id)).toBe(true);
    // A rejected tag no longer shows on the highlight.
    const view = (await getEntry(t.db, OWNER_USER_ID, e.entry.id))!;
    expect(view.highlights[0].tags.map((x) => x.name)).toEqual(["bright wide"]);
  });

  it("exports the user's rows including soft-deleted ones", async () => {
    const e = await entry("Export Made Up", { note: "n" });
    await softDeleteEntry(t.db, OWNER_USER_ID, e.entry.id);
    const dump = await exportAll(t.db, OWNER_USER_ID);
    expect(dump.entries.some((x) => x.id === e.entry.id && x.deletedAt)).toBe(true);
    expect(dump.highlights.some((x) => x.id === e.highlight.id)).toBe(true);
    expect(dump.entry_sources.some((x) => x.entryId === e.entry.id)).toBe(true);
    expect(Object.keys(dump)).not.toContain("oauth_tokens");
    const other = await insertUser(t.db);
    expect((await exportAll(t.db, other.id)).entries).toEqual([]);
  });
});

describe("restore", () => {
  it("restores an entry and the highlights deleted with it, not earlier-deleted ones", async () => {
    const e = await entry("Restore Made Up", { note: "one", startSec: 5 });
    const h2 = await addHighlight(t.db, OWNER_USER_ID, e.entry.id, { startSec: 50, note: "two" });
    const h3 = await addHighlight(t.db, OWNER_USER_ID, e.entry.id, { startSec: 90, note: "three" });
    await softDeleteHighlight(t.db, OWNER_USER_ID, h3.id);
    await new Promise((r) => setTimeout(r, 5));
    await softDeleteEntry(t.db, OWNER_USER_ID, e.entry.id);
    const deleted = (await listDeletedEntries(t.db, OWNER_USER_ID)).find((v) => v.entry.id === e.entry.id)!;
    expect(deleted.highlights.map((h) => h.id).sort()).toEqual([e.highlight.id, h2.id].sort());

    const res = await restoreEntry(t.db, OWNER_USER_ID, e.entry.id);
    expect(res.restored).toBe(true);
    const live = (await getEntry(t.db, OWNER_USER_ID, e.entry.id))!;
    expect(live.highlights.map((h) => h.id).sort()).toEqual([e.highlight.id, h2.id].sort());
  });

  it("refuses when a live entry has the same source and reports it", async () => {
    const e = await entry("Conflict Made Up", { note: "old" }, "conflict-src");
    await softDeleteEntry(t.db, OWNER_USER_ID, e.entry.id);
    const live = await entry("Conflict Made Up Again", { note: "new" }, "conflict-src");
    const res = await restoreEntry(t.db, OWNER_USER_ID, e.entry.id);
    expect(res).toEqual({ restored: false, conflict: { id: live.entry.id, title: "Conflict Made Up Again" } });
    expect(await getEntry(t.db, OWNER_USER_ID, e.entry.id)).toBeNull();
  });

  it("moves the deleted highlights onto the live entry instead", async () => {
    const e = await entry("Move Made Up", { note: "old why", startSec: 12 }, "move-src");
    await softDeleteEntry(t.db, OWNER_USER_ID, e.entry.id);
    const live = await entry("Move Made Up Live", { note: "live why" }, "move-src");
    const r = await moveDeletedHighlightsToLiveEntry(t.db, OWNER_USER_ID, e.entry.id);
    expect(r).toEqual({ entryId: live.entry.id, moved: 1 });
    const view = (await getEntry(t.db, OWNER_USER_ID, live.entry.id))!;
    expect(view.highlights.map((h) => h.note).sort()).toEqual(["live why", "old why"]);
    // Nothing left to move or restore afterwards.
    expect((await listDeletedEntries(t.db, OWNER_USER_ID)).find((v) => v.entry.id === e.entry.id)!.highlights).toEqual([]);
  });

  it("refuses to move when no live entry has the source, and not_found for live or foreign entries", async () => {
    const e = await entry("Nomove Made Up", { note: "x" });
    await softDeleteEntry(t.db, OWNER_USER_ID, e.entry.id);
    await expect(moveDeletedHighlightsToLiveEntry(t.db, OWNER_USER_ID, e.entry.id)).rejects.toMatchObject({ code: "invalid_state" });
    const live = await entry("Live Made Up", { note: "x" });
    await expect(restoreEntry(t.db, OWNER_USER_ID, live.entry.id)).rejects.toMatchObject({ code: "not_found" });
    const other = await insertUser(t.db);
    await expect(restoreEntry(t.db, other.id, e.entry.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("restore and a simultaneous save of the same source never leave two live entries", async () => {
    const e = await entry("Race Made Up", { note: "x" }, "race-src");
    await softDeleteEntry(t.db, OWNER_USER_ID, e.entry.id);
    const [restored, saved] = await Promise.all([
      restoreEntry(t.db, OWNER_USER_ID, e.entry.id),
      addEntry(t.db, OWNER_USER_ID, { title: "Race Made Up 2", source: src("race-src") }),
    ]);
    const live = (await listEntries(t.db, OWNER_USER_ID, { limit: 200 })).filter((v) => v.source?.externalId === "race-src");
    expect(live).toHaveLength(1);
    expect(Boolean(restored.restored) !== Boolean(!saved.duplicate)).toBe(true);
  });
});
