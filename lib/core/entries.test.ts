import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { highlights } from "../db";
import { createTestDb, insertUser } from "../db/test-utils";
import { addEntry, findDuplicateEntry, softDeleteEntry } from "./entries";
import { addHighlight, loadHighlight, setHighlightNote, softDeleteHighlight } from "./highlights";
import { OWNER_USER_ID } from "./owner";
import { normalizeNote, normalizeTagName } from "./text";

let t: Awaited<ReturnType<typeof createTestDb>>;
let n = 0;
const src = () => ({
  type: "youtube" as const,
  externalId: `vid${++n}`,
  url: `https://youtu.be/vid${n}`,
});

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

async function fresh(note?: string | null) {
  const r = await addEntry(t.db, OWNER_USER_ID, { title: "Made Up Song", source: src(), highlight: { note } });
  if (r.duplicate) throw new Error("unexpected duplicate");
  return r;
}

describe("normalizeNote", () => {
  it("turns blank and whitespace into null, keeps text verbatim", () => {
    expect(normalizeNote("")).toBeNull();
    expect(normalizeNote("  \n\t ")).toBeNull();
    expect(normalizeNote(undefined)).toBeNull();
    expect(normalizeNote("  keep me  ")).toBe("  keep me  ");
  });
});

describe("normalizeTagName", () => {
  it("accepts lowercase 1-4 words with hyphens and normalizes case and spacing", () => {
    expect(normalizeTagName("  Interlocking  Guitars ")).toEqual({ name: "interlocking guitars", slug: "interlocking-guitars" });
    expect(normalizeTagName("chorus-drenched guitar").slug).toBe("chorus-drenched-guitar");
  });
  it("refuses empty, too long and punctuated names", () => {
    for (const bad of ["", "   ", "a b c d e", "no, commas", "under_score", "-lead"]) {
      expect(() => normalizeTagName(bad), bad).toThrow(/Invalid tag name/);
    }
  });
});

describe("addEntry", () => {
  it("saves with no note as needs_why, whole work", async () => {
    const r = await fresh();
    expect(r.highlight.status).toBe("needs_why");
    expect(r.highlight.note).toBeNull();
    expect(r.highlight.startSec).toBeNull();
    expect(r.highlight.searchDirty).toBe(true);
    expect(r.entry.matchStatus).toBe("unmatched");
  });

  it("saves with a note as needs_tags", async () => {
    const r = await fresh("the guitars weave");
    expect(r.highlight.status).toBe("needs_tags");
    expect(r.highlight.noteUpdatedAt).not.toBeNull();
  });

  it("stores a whitespace-only note as NULL (needs_why)", async () => {
    const r = await fresh("   \n ");
    expect(r.highlight.note).toBeNull();
    expect(r.highlight.status).toBe("needs_why");
  });

  it("refuses a blank title and bad times", async () => {
    await expect(addEntry(t.db, OWNER_USER_ID, { title: "  ", source: src() })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      addEntry(t.db, OWNER_USER_ID, { title: "x", source: src(), highlight: { startSec: 30, endSec: 20 } }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      addEntry(t.db, OWNER_USER_ID, { title: "x", source: src(), highlight: { endSec: 20 } }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("detects duplicates by (user, type, external id) without writing", async () => {
    const first = await fresh();
    const again = await addEntry(t.db, OWNER_USER_ID, {
      title: "Other Title",
      source: { type: "youtube", externalId: first.source.externalId, url: first.source.url },
    });
    expect(again.duplicate?.id).toBe(first.entry.id);
    expect(await findDuplicateEntry(t.db, OWNER_USER_ID, "youtube", first.source.externalId)).not.toBeNull();
  });

  it("does not treat another user's entry as a duplicate", async () => {
    const other = await insertUser(t.db);
    const first = await fresh();
    const r = await addEntry(t.db, other.id, {
      title: "Mine",
      source: { type: "youtube", externalId: first.source.externalId, url: first.source.url },
    });
    expect(r.duplicate).toBeUndefined();
  });

  it("ignores soft-deleted entries when checking duplicates", async () => {
    const first = await fresh();
    await softDeleteEntry(t.db, OWNER_USER_ID, first.entry.id);
    expect(await findDuplicateEntry(t.db, OWNER_USER_ID, "youtube", first.source.externalId)).toBeNull();
  });
});

describe("note status transitions", () => {
  it("needs_why -> needs_tags when a note is added", async () => {
    const r = await fresh();
    const h = await setHighlightNote(t.db, OWNER_USER_ID, r.highlight.id, "sparse and slow");
    expect(h.status).toBe("needs_tags");
    expect(h.note).toBe("sparse and slow");
  });

  it("needs_tags -> needs_why when the note is cleared, including with blank text", async () => {
    const r = await fresh("a note");
    const h = await setHighlightNote(t.db, OWNER_USER_ID, r.highlight.id, "   ");
    expect(h.note).toBeNull();
    expect(h.status).toBe("needs_why");
  });

  it("an unchanged note is a no-op", async () => {
    const r = await fresh("same");
    const h = await setHighlightNote(t.db, OWNER_USER_ID, r.highlight.id, "same");
    expect(h.updatedAt).toEqual(r.highlight.updatedAt);
  });

  it("updated_at moves on update (drizzle $onUpdate)", async () => {
    const r = await fresh("a");
    await new Promise((res) => setTimeout(res, 5));
    const h = await setHighlightNote(t.db, OWNER_USER_ID, r.highlight.id, "b");
    expect(h.updatedAt.getTime()).toBeGreaterThan(r.highlight.updatedAt.getTime());
  });

  it("refuses another user's highlight", async () => {
    const other = await insertUser(t.db);
    const r = await fresh("a");
    await expect(setHighlightNote(t.db, other.id, r.highlight.id, "b")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("soft delete", () => {
  it("refuses to delete the last live highlight of an entry", async () => {
    const r = await fresh("a");
    await expect(softDeleteHighlight(t.db, OWNER_USER_ID, r.highlight.id)).rejects.toMatchObject({ code: "last_highlight" });
    expect((await loadHighlight(t.db, OWNER_USER_ID, r.highlight.id)).deletedAt).toBeNull();
  });

  it("deletes a highlight when another live one remains, then refuses the last", async () => {
    const r = await fresh("a");
    const second = await addHighlight(t.db, OWNER_USER_ID, r.entry.id, { startSec: 10, endSec: 20 });
    await softDeleteHighlight(t.db, OWNER_USER_ID, second.id);
    await expect(loadHighlight(t.db, OWNER_USER_ID, second.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(softDeleteHighlight(t.db, OWNER_USER_ID, r.highlight.id)).rejects.toMatchObject({ code: "last_highlight" });
  });

  it("deleting an entry soft-deletes it and all its highlights", async () => {
    const r = await fresh("a");
    await addHighlight(t.db, OWNER_USER_ID, r.entry.id, { startSec: 5 });
    await softDeleteEntry(t.db, OWNER_USER_ID, r.entry.id);
    const live = await t.db
      .select()
      .from(highlights)
      .where(and(eq(highlights.entryId, r.entry.id), isNull(highlights.deletedAt)));
    expect(live).toHaveLength(0);
    await expect(softDeleteEntry(t.db, OWNER_USER_ID, r.entry.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(addHighlight(t.db, OWNER_USER_ID, r.entry.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("another user can't delete my entry", async () => {
    const other = await insertUser(t.db);
    const r = await fresh("a");
    await expect(softDeleteEntry(t.db, other.id, r.entry.id)).rejects.toMatchObject({ code: "not_found" });
  });
});
