import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { highlights, highlightTags, tags } from "../db";
import { createTestDb, insertEntry, insertHighlight, insertTag, insertUser } from "../db/test-utils";
import { addEntry } from "./entries";
import { loadHighlight, setHighlightNote } from "./highlights";
import { OWNER_USER_ID } from "./owner";
import {
  approveTag,
  attachTagsToHighlight,
  mergeTags,
  rejectTag,
  removeTagFromHighlight,
  renameTag,
  setHighlightTags,
} from "./tags";

let t: Awaited<ReturnType<typeof createTestDb>>;
let n = 0;

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

async function hl(opts: { note?: string | null; userId?: string } = {}) {
  const userId = opts.userId ?? OWNER_USER_ID;
  const r = await addEntry(t.db, userId, {
    title: "Made Up Song",
    source: { type: "youtube", externalId: `tv${++n}`, url: "https://youtu.be/x" },
    highlight: { note: opts.note === undefined ? "a note" : opts.note },
  });
  if (r.duplicate) throw new Error("dup");
  return r.highlight;
}

const rows = (highlightId: string) =>
  t.db.select().from(highlightTags).where(eq(highlightTags.highlightId, highlightId));

describe("setHighlightTags", () => {
  it("creates new tags as proposed (agent), attaches them and sets status tagged", async () => {
    const h = await hl();
    const r = await setHighlightTags(
      t.db,
      OWNER_USER_ID,
      h.id,
      [
        { name: "Interlocking Guitars", axis: "technique" },
        { name: "sparse", axis: "sound" },
      ],
      { agentName: "Test Agent" },
    );
    expect(r.highlight.status).toBe("tagged");
    expect(r.highlight.searchDirty).toBe(true);
    expect(r.created.map((c) => [c.slug, c.state, c.createdBy])).toEqual([
      ["interlocking-guitars", "proposed", "agent"],
      ["sparse", "proposed", "agent"],
    ]);
    const attached = await rows(h.id);
    expect(attached).toHaveLength(2);
    expect(attached.every((a) => a.addedBy === "agent" && a.agentName === "Test Agent")).toBe(true);
  });

  it("is a diff: kept tags keep added_at, new ones get attached, missing ones detach", async () => {
    const h = await hl();
    await setHighlightTags(t.db, OWNER_USER_ID, h.id, [
      { name: "keep me", axis: "feeling" },
      { name: "drop me", axis: "feeling" },
    ]);
    const before = await rows(h.id);
    const keepTagId = (await t.db.select().from(tags).where(eq(tags.slug, "keep-me")))[0].id;
    const keptAddedAt = before.find((b) => b.tagId === keepTagId)!.addedAt;
    await new Promise((res) => setTimeout(res, 5));

    const r = await setHighlightTags(t.db, OWNER_USER_ID, h.id, [
      { name: "keep me", axis: "feeling" },
      { name: "brand new", axis: "feeling" },
    ]);
    expect(r.added.map((a) => a.slug)).toEqual(["brand-new"]);
    expect(r.removedTagIds).toHaveLength(1);
    const after = await rows(h.id);
    expect(after).toHaveLength(2);
    expect(after.find((a) => a.tagId === keepTagId)!.addedAt).toEqual(keptAddedAt);
  });

  it("reuses an existing tag instead of creating a duplicate", async () => {
    const a = await hl();
    const b = await hl();
    await setHighlightTags(t.db, OWNER_USER_ID, a.id, [{ name: "shared tag", axis: "sound" }]);
    const r = await setHighlightTags(t.db, OWNER_USER_ID, b.id, [{ name: "Shared Tag", axis: "sound" }]);
    expect(r.created).toHaveLength(0);
  });

  it("is refused on a needs_why highlight", async () => {
    const h = await hl({ note: null });
    await expect(setHighlightTags(t.db, OWNER_USER_ID, h.id, [{ name: "x", axis: "sound" }])).rejects.toMatchObject({
      code: "needs_why",
    });
    expect(await rows(h.id)).toHaveLength(0);
  });

  it("an empty list detaches everything and returns to needs_tags", async () => {
    const h = await hl();
    await setHighlightTags(t.db, OWNER_USER_ID, h.id, [{ name: "gone soon", axis: "sound" }]);
    const r = await setHighlightTags(t.db, OWNER_USER_ID, h.id, []);
    expect(r.highlight.status).toBe("needs_tags");
    expect(await rows(h.id)).toHaveLength(0);
  });

  it("validates axis and name, and writes nothing on failure", async () => {
    const h = await hl();
    await expect(
      setHighlightTags(t.db, OWNER_USER_ID, h.id, [
        { name: "fine tag", axis: "sound" },
        { name: "bad axis", axis: "genre" },
      ]),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      setHighlightTags(t.db, OWNER_USER_ID, h.id, [{ name: "Bad, name", axis: "sound" }]),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(await t.db.select().from(tags).where(eq(tags.slug, "fine-tag"))).toHaveLength(0);
  });

  it("refuses a rejected tag (per axis), but the same slug on another axis is fine", async () => {
    const h = await hl();
    const r1 = await setHighlightTags(t.db, OWNER_USER_ID, h.id, [{ name: "rejectable", axis: "sound" }]);
    await rejectTag(t.db, OWNER_USER_ID, r1.created[0].id);
    await expect(
      setHighlightTags(t.db, OWNER_USER_ID, h.id, [{ name: "rejectable", axis: "sound" }]),
    ).rejects.toMatchObject({ code: "tag_rejected" });
    await expect(
      setHighlightTags(t.db, OWNER_USER_ID, h.id, [{ name: "rejectable", axis: "feeling" }]),
    ).resolves.toBeDefined();
  });

  it("a merged name resolves to the surviving tag", async () => {
    const h = await hl();
    const r = await setHighlightTags(t.db, OWNER_USER_ID, h.id, [
      { name: "woven guitars", axis: "technique" },
      { name: "weaving lines", axis: "technique" },
    ]);
    const [woven, interlocking] = r.created;
    await mergeTags(t.db, OWNER_USER_ID, [woven.id], interlocking.id);
    const h2 = await hl();
    const r2 = await setHighlightTags(t.db, OWNER_USER_ID, h2.id, [{ name: "woven guitars", axis: "technique" }]);
    expect(r2.added.map((a) => a.id)).toEqual([interlocking.id]);
    expect(r2.created).toHaveLength(0);
  });

  it("refuses an alias whose surviving tag was later rejected", async () => {
    const h = await hl();
    const r = await setHighlightTags(t.db, OWNER_USER_ID, h.id, [
      { name: "alias gone", axis: "technique" },
      { name: "survivor gone", axis: "technique" },
    ]);
    const [alias, survivor] = r.created;
    await mergeTags(t.db, OWNER_USER_ID, [alias.id], survivor.id);
    await rejectTag(t.db, OWNER_USER_ID, survivor.id);
    const h2 = await hl();
    await expect(
      setHighlightTags(t.db, OWNER_USER_ID, h2.id, [{ name: "alias gone", axis: "technique" }]),
    ).rejects.toMatchObject({ code: "tag_rejected" });
    expect(await rows(h2.id)).toHaveLength(0);
  });

  it("is scoped to the user: another user can't tag my highlight, and vocabularies are separate", async () => {
    const other = await insertUser(t.db);
    const mine = await hl();
    await expect(
      setHighlightTags(t.db, other.id, mine.id, [{ name: "nope", axis: "sound" }]),
    ).rejects.toMatchObject({ code: "not_found" });
    const theirs = await hl({ userId: other.id });
    await setHighlightTags(t.db, OWNER_USER_ID, mine.id, [{ name: "vocab test", axis: "sound" }]);
    const r = await setHighlightTags(t.db, other.id, theirs.id, [{ name: "vocab test", axis: "sound" }]);
    expect(r.created).toHaveLength(1);
    expect(r.created[0].userId).toBe(other.id);
  });
});

describe("highlight_tags cross-user check", () => {
  it("attachTagsToHighlight refuses a tag owned by another user", async () => {
    const other = await insertUser(t.db);
    const h = await hl();
    const foreignTag = await insertTag(t.db, { userId: other.id, slug: "foreign", name: "foreign" });
    await expect(attachTagsToHighlight(t.db, h, [foreignTag])).rejects.toMatchObject({ code: "cross_user" });
    expect(await rows(h.id)).toHaveLength(0);
  });

  it("attachTagsToHighlight ignores a spoofed userId on the highlight argument", async () => {
    const other = await insertUser(t.db);
    const h = await hl();
    const foreignTag = await insertTag(t.db, { userId: other.id, slug: "spoofed", name: "spoofed" });
    const spoofed = { id: h.id, userId: other.id };
    await expect(attachTagsToHighlight(t.db, spoofed, [foreignTag])).rejects.toMatchObject({ code: "cross_user" });
    expect(await rows(h.id)).toHaveLength(0);
  });

  it("attaches same-user tags and never resets added_at on repeat", async () => {
    const h = await hl();
    const tag = await insertTag(t.db, { slug: "own", name: "own" });
    await attachTagsToHighlight(t.db, h, [tag]);
    const [first] = await rows(h.id);
    await new Promise((res) => setTimeout(res, 5));
    await attachTagsToHighlight(t.db, h, [tag]);
    const [second] = await rows(h.id);
    expect(second.addedAt).toEqual(first.addedAt);
  });

  it("mergeTags refuses another user's tags", async () => {
    const other = await insertUser(t.db);
    const mine = await insertTag(t.db, { slug: "m-mine", name: "m mine" });
    const theirs = await insertTag(t.db, { userId: other.id, slug: "m-theirs", name: "m theirs" });
    await expect(mergeTags(t.db, OWNER_USER_ID, [theirs.id], mine.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(mergeTags(t.db, OWNER_USER_ID, [mine.id], theirs.id)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("status transitions with tags", () => {
  async function tagged() {
    const h = await hl();
    const r = await setHighlightTags(t.db, OWNER_USER_ID, h.id, [{ name: `only one ${++n}`, axis: "sound" }]);
    return { h, tag: r.created[0] };
  }

  it("note edited on tagged -> needs_tags, tags kept", async () => {
    const { h } = await tagged();
    const after = await setHighlightNote(t.db, OWNER_USER_ID, h.id, "a different note");
    expect(after.status).toBe("needs_tags");
    expect(await rows(h.id)).toHaveLength(1);
  });

  it("note cleared on tagged -> needs_why, tags kept but not usable until a note exists", async () => {
    const { h } = await tagged();
    const after = await setHighlightNote(t.db, OWNER_USER_ID, h.id, null);
    expect(after.status).toBe("needs_why");
    expect(await rows(h.id)).toHaveLength(1);
    await expect(setHighlightTags(t.db, OWNER_USER_ID, h.id, [])).rejects.toMatchObject({ code: "needs_why" });
    const back = await setHighlightNote(t.db, OWNER_USER_ID, h.id, "back again");
    expect(back.status).toBe("needs_tags");
  });

  it("removing the last tag sends tagged -> needs_tags and marks dirty", async () => {
    const { h, tag } = await tagged();
    await t.db.update(highlights).set({ searchDirty: false }).where(eq(highlights.id, h.id));
    await removeTagFromHighlight(t.db, OWNER_USER_ID, h.id, tag.id);
    const after = await loadHighlight(t.db, OWNER_USER_ID, h.id);
    expect(after.status).toBe("needs_tags");
    expect(after.searchDirty).toBe(true);
  });

  it("removing one of two tags keeps tagged", async () => {
    const h = await hl();
    const r = await setHighlightTags(t.db, OWNER_USER_ID, h.id, [
      { name: "two a", axis: "sound" },
      { name: "two b", axis: "sound" },
    ]);
    await removeTagFromHighlight(t.db, OWNER_USER_ID, h.id, r.created[0].id);
    expect((await loadHighlight(t.db, OWNER_USER_ID, h.id)).status).toBe("tagged");
    await expect(removeTagFromHighlight(t.db, OWNER_USER_ID, h.id, r.created[0].id)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("rejecting a tag removes assignments, keeps the row, and reverts highlights left with no tags", async () => {
    const { h, tag } = await tagged();
    const h2 = await hl();
    await setHighlightTags(t.db, OWNER_USER_ID, h2.id, [
      { name: tag.name, axis: "sound" },
      { name: "second tag", axis: "sound" },
    ]);
    await t.db.update(highlights).set({ searchDirty: false });
    const rejected = await rejectTag(t.db, OWNER_USER_ID, tag.id);
    expect(rejected.state).toBe("rejected");
    expect((await t.db.select().from(tags).where(eq(tags.id, tag.id)))).toHaveLength(1);
    const a = await loadHighlight(t.db, OWNER_USER_ID, h.id);
    const b = await loadHighlight(t.db, OWNER_USER_ID, h2.id);
    expect([a.status, a.searchDirty]).toEqual(["needs_tags", true]);
    expect([b.status, b.searchDirty]).toEqual(["tagged", true]);
  });
});

describe("tag lifecycle", () => {
  it("approve sets state and approved_at; repeat is a no-op; rejected can't be approved", async () => {
    const tag = await insertTag(t.db, { slug: "to-approve", name: "to approve", state: "proposed" });
    const a = await approveTag(t.db, OWNER_USER_ID, tag.id);
    expect(a.state).toBe("approved");
    expect(a.approvedAt).not.toBeNull();
    expect((await approveTag(t.db, OWNER_USER_ID, tag.id)).approvedAt).toEqual(a.approvedAt);
    const rej = await insertTag(t.db, { slug: "was-rejected", name: "was rejected", state: "rejected" });
    await expect(approveTag(t.db, OWNER_USER_ID, rej.id)).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("rename changes name and slug, marks carriers dirty, and refuses a clash", async () => {
    const h = await hl();
    const r = await setHighlightTags(t.db, OWNER_USER_ID, h.id, [
      { name: "old name", axis: "feeling" },
      { name: "taken name", axis: "feeling" },
    ]);
    await t.db.update(highlights).set({ searchDirty: false }).where(eq(highlights.id, h.id));
    const renamed = await renameTag(t.db, OWNER_USER_ID, r.created[0].id, "New Name");
    expect([renamed.name, renamed.slug]).toEqual(["new name", "new-name"]);
    expect((await loadHighlight(t.db, OWNER_USER_ID, h.id)).searchDirty).toBe(true);
    await expect(renameTag(t.db, OWNER_USER_ID, r.created[0].id, "taken name")).rejects.toMatchObject({
      code: "tag_conflict",
    });
  });

  it("merge aggregates several sources on one highlight and keeps the earliest added_at", async () => {
    const h = await insertHighlightWithNote();
    const target = await insertTag(t.db, { slug: "mg-target", name: "mg target", state: "approved" });
    const s1 = await insertTag(t.db, { slug: "mg-s1", name: "mg s1" });
    const s2 = await insertTag(t.db, { slug: "mg-s2", name: "mg s2" });
    const early = new Date("2026-01-01T00:00:00Z");
    const mid = new Date("2026-02-01T00:00:00Z");
    const late = new Date("2026-03-01T00:00:00Z");
    await t.db.insert(highlightTags).values([
      { highlightId: h.id, tagId: s1.id, addedAt: late },
      { highlightId: h.id, tagId: s2.id, addedAt: early },
      { highlightId: h.id, tagId: target.id, addedAt: mid },
    ]);
    // A second highlight carries only one source.
    const h2 = await insertHighlightWithNote();
    await t.db.insert(highlightTags).values({ highlightId: h2.id, tagId: s1.id, addedAt: late });
    await t.db.update(highlights).set({ searchDirty: false });

    await mergeTags(t.db, OWNER_USER_ID, [s1.id, s2.id], target.id);

    const onH = await rows(h.id);
    expect(onH).toHaveLength(1);
    expect(onH[0].tagId).toBe(target.id);
    expect(onH[0].addedAt).toEqual(early);
    expect((await rows(h2.id))[0]).toMatchObject({ tagId: target.id, addedAt: late });
    const [m1] = await t.db.select().from(tags).where(eq(tags.id, s1.id));
    expect([m1.state, m1.mergedInto]).toEqual(["merged", target.id]);
    expect((await loadHighlight(t.db, OWNER_USER_ID, h.id)).searchDirty).toBe(true);
    expect((await loadHighlight(t.db, OWNER_USER_ID, h2.id)).searchDirty).toBe(true);
  });

  it("merge takes added_by/agent_name from the row with the earliest added_at", async () => {
    const h = await insertHighlightWithNote();
    const target = await insertTag(t.db, { slug: "mb-target", name: "mb target", state: "approved" });
    const src = await insertTag(t.db, { slug: "mb-src", name: "mb src" });
    await t.db.insert(highlightTags).values([
      { highlightId: h.id, tagId: src.id, addedAt: new Date("2026-01-01T00:00:00Z"), addedBy: "agent", agentName: "early-agent" },
      { highlightId: h.id, tagId: target.id, addedAt: new Date("2026-02-01T00:00:00Z"), addedBy: "user", agentName: null },
    ]);
    await mergeTags(t.db, OWNER_USER_ID, [src.id], target.id);
    const [row] = await rows(h.id);
    expect(row).toMatchObject({ tagId: target.id, addedBy: "agent", agentName: "early-agent" });
    expect(row.addedAt).toEqual(new Date("2026-01-01T00:00:00Z"));
  });

  it("merge re-points earlier merges so chains never form, and enforces rules", async () => {
    const a = await insertTag(t.db, { slug: "ch-a", name: "ch a" });
    const b = await insertTag(t.db, { slug: "ch-b", name: "ch b" });
    const c = await insertTag(t.db, { slug: "ch-c", name: "ch c" });
    await mergeTags(t.db, OWNER_USER_ID, [a.id], b.id);
    await mergeTags(t.db, OWNER_USER_ID, [b.id], c.id);
    const [aRow] = await t.db.select().from(tags).where(eq(tags.id, a.id));
    expect(aRow.mergedInto).toBe(c.id);
    await expect(mergeTags(t.db, OWNER_USER_ID, [c.id], c.id)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(mergeTags(t.db, OWNER_USER_ID, [a.id], c.id)).rejects.toMatchObject({ code: "invalid_state" });
    const other = await insertTag(t.db, { slug: "ch-x", name: "ch x", axis: "sound" });
    await expect(mergeTags(t.db, OWNER_USER_ID, [other.id], c.id)).rejects.toMatchObject({ code: "invalid_input" });
  });
});

async function insertHighlightWithNote() {
  const e = await insertEntry(t.db, { title: "Fixture" });
  return insertHighlight(t.db, { entryId: e.id });
}
