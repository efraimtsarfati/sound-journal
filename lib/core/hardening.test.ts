import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { entries, tags } from "../db";
import { createTestDb } from "../db/test-utils";
import { addEntry, lockSource } from "./entries";
import { addHighlight, setHighlightNote } from "./highlights";
import { OWNER_USER_ID } from "./owner";
import { approveTag, mergeTags, setHighlightTags } from "./tags";

let t: Awaited<ReturnType<typeof createTestDb>>;
let n = 0;
const src = (id = `hard${++n}`) => ({ type: "youtube" as const, externalId: id, url: `https://youtu.be/${id}` });

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

describe("per-source advisory lock", () => {
  it("lockSource takes a transaction-scoped advisory lock that is released at commit", async () => {
    const count = sql`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`;
    await t.db.transaction(async (tx) => {
      await lockSource(tx, OWNER_USER_ID, "youtube", "lockprobe");
      const rows = await tx.execute<{ n: number }>(count);
      expect(rows.rows[0].n).toBeGreaterThan(0);
    });
    const after = await t.db.execute<{ n: number }>(count);
    expect(after.rows[0].n).toBe(0);
  });

  it("simultaneous saves of one source produce one entry and one duplicate", async () => {
    const s = src("same-source");
    const results = await Promise.all([
      addEntry(t.db, OWNER_USER_ID, { title: "Made Up Song", source: s }),
      addEntry(t.db, OWNER_USER_ID, { title: "Made Up Song", source: s }),
      addEntry(t.db, OWNER_USER_ID, { title: "Made Up Song", source: s }),
    ]);
    expect(results.filter((r) => r.duplicate)).toHaveLength(2);
    const live = await t.db
      .select({ id: entries.id })
      .from(entries)
      .where(and(eq(entries.userId, OWNER_USER_ID), eq(entries.title, "Made Up Song"), isNull(entries.deletedAt)));
    const ids = results.map((r) => (r.duplicate ? r.duplicate.id : r.entry.id));
    expect(new Set(ids).size).toBe(1);
    expect(live.some((e) => e.id === ids[0])).toBe(true);
  });
});

describe("transactional paths", () => {
  async function fresh(note?: string) {
    const r = await addEntry(t.db, OWNER_USER_ID, { title: "Hardening Song", source: src(), highlight: { note } });
    if (r.duplicate) throw new Error("unexpected duplicate");
    return r;
  }

  it("addHighlight and setHighlightNote keep their sequential outcomes", async () => {
    const r = await fresh();
    const h2 = await addHighlight(t.db, OWNER_USER_ID, r.entry.id, { note: "why" });
    expect(h2.status).toBe("needs_tags");
    const same = await setHighlightNote(t.db, OWNER_USER_ID, h2.id, "why");
    expect(same.status).toBe("needs_tags");
    const cleared = await setHighlightNote(t.db, OWNER_USER_ID, h2.id, null);
    expect(cleared.status).toBe("needs_why");
  });

  it("concurrent setHighlightTags naming the same new tag create it once", async () => {
    const a = await fresh("a");
    const b = await fresh("b");
    const [ra, rb] = await Promise.all([
      setHighlightTags(t.db, OWNER_USER_ID, a.highlight.id, [{ name: "race tag", axis: "sound" }]),
      setHighlightTags(t.db, OWNER_USER_ID, b.highlight.id, [{ name: "race tag", axis: "sound" }]),
    ]);
    expect(ra.created.length + rb.created.length).toBe(1);
    const rows = await t.db.select().from(tags).where(eq(tags.slug, "race-tag"));
    expect(rows).toHaveLength(1);
  });

  it("merge then setHighlightTags resolves to the survivor; approve is idempotent", async () => {
    const a = await fresh("a");
    const r1 = await setHighlightTags(t.db, OWNER_USER_ID, a.highlight.id, [
      { name: "merge src", axis: "sound" },
      { name: "merge dst", axis: "sound" },
    ]);
    const [src1, dst] = ["merge src", "merge dst"].map((nm) => r1.added.find((x) => x.name === nm)!);
    await mergeTags(t.db, OWNER_USER_ID, [src1.id], dst.id);
    const r2 = await setHighlightTags(t.db, OWNER_USER_ID, a.highlight.id, [{ name: "merge src", axis: "sound" }]);
    expect(r2.highlight.status).toBe("tagged");
    const approved = await approveTag(t.db, OWNER_USER_ID, dst.id);
    expect((await approveTag(t.db, OWNER_USER_ID, dst.id)).approvedAt).toEqual(approved.approvedAt);
  });
});
