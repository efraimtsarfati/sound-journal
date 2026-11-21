import { and, eq, inArray, sql } from "drizzle-orm";
import { highlights, highlightTags, tags, type Db, type DbOrTx, type Highlight, type Tag } from "../db";
import { CoreError } from "./errors";
import { loadHighlight } from "./highlights";
import { assertAxis, normalizeTagName } from "./text";

export type TagInput = { name: string; axis: string };

const USABLE = ["proposed", "approved"] as const;

/** Loads a tag owned by the user, or throws not_found. */
async function loadTag(db: DbOrTx, userId: string, tagId: string): Promise<Tag> {
  const [row] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.id, tagId), eq(tags.userId, userId)));
  if (!row) throw new CoreError("not_found", "Tag not found.");
  return row;
}

/**
 * Attaches tags to a highlight. Refuses any tag owned by a different user than the
 * highlight (the database only enforces this for tags.merged_into).
 * Existing assignments are left untouched, so `added_at` is never reset.
 */
export async function attachTagsToHighlight(
  db: DbOrTx,
  highlight: Pick<Highlight, "id" | "userId">,
  tagsToAttach: Pick<Tag, "id" | "userId">[],
  meta: { addedBy?: "agent" | "user"; agentName?: string | null } = {},
): Promise<void> {
  if (tagsToAttach.some((t) => t.userId !== highlight.userId)) {
    throw new CoreError("cross_user", "A tag and a highlight must belong to the same user.");
  }
  if (tagsToAttach.length === 0) return;
  await db
    .insert(highlightTags)
    .values(
      tagsToAttach.map((t) => ({
        highlightId: highlight.id,
        tagId: t.id,
        addedBy: meta.addedBy ?? "agent",
        agentName: meta.agentName ?? null,
      })),
    )
    .onConflictDoNothing();
}

/** Finds the tag for an agent-supplied name, creating it as `proposed` if new. */
async function resolveOrCreateTag(
  tx: DbOrTx,
  userId: string,
  input: TagInput,
): Promise<{ tag: Tag; created: boolean }> {
  assertAxis(input.axis);
  const { name, slug } = normalizeTagName(input.name);
  const [found] = await tx
    .select()
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.axis, input.axis), eq(tags.slug, slug)));
  if (!found) {
    const [created] = await tx
      .insert(tags)
      .values({ userId, axis: input.axis, name, slug, state: "proposed", createdBy: "agent" })
      .returning();
    return { tag: created, created: true };
  }
  if (found.state === "rejected") {
    throw new CoreError("tag_rejected", `The tag "${name}" on axis ${input.axis} was rejected; don't propose it again.`);
  }
  if (found.state === "merged") return { tag: await loadTag(tx, userId, found.mergedInto!), created: false };
  return { tag: found, created: false };
}

/** Marks a highlight's vector copy dirty and, if it was tagged but has no tags left, sends it back to needs_tags. */
async function afterTagsRemoved(tx: DbOrTx, userId: string, highlightIds: string[]): Promise<void> {
  if (highlightIds.length === 0) return;
  await tx
    .update(highlights)
    .set({ searchDirty: true })
    .where(and(eq(highlights.userId, userId), inArray(highlights.id, highlightIds)));
  await tx
    .update(highlights)
    .set({ status: "needs_tags" })
    .where(
      and(
        eq(highlights.userId, userId),
        inArray(highlights.id, highlightIds),
        eq(highlights.status, "tagged"),
        sql`NOT EXISTS (SELECT 1 FROM highlight_tags ht WHERE ht.highlight_id = ${highlights.id})`,
      ),
    );
}

/**
 * Sets a highlight's full tag list as a diff (docs/mcp-server.md). Kept tags keep their
 * `added_at`; new names are created as `proposed`; missing tags are detached. Status becomes
 * `tagged` (or `needs_tags` if the list is empty). Refused when the highlight has no note.
 * Refused for rejected tags. Names that were merged resolve to the surviving tag.
 */
export async function setHighlightTags(
  db: Db,
  userId: string,
  highlightId: string,
  inputs: TagInput[],
  opts: { agentName?: string | null } = {},
): Promise<{ highlight: Highlight; added: Tag[]; removedTagIds: string[]; created: Tag[] }> {
  return db.transaction(async (tx) => {
    const h = await loadHighlight(tx, userId, highlightId);
    if (h.status === "needs_why") {
      throw new CoreError("needs_why", "This highlight has no note yet. Ask for the why before tagging.");
    }
    const desired = new Map<string, Tag>();
    const created: Tag[] = [];
    for (const input of inputs) {
      const { tag, created: isNew } = await resolveOrCreateTag(tx, userId, input);
      if (isNew) created.push(tag);
      desired.set(tag.id, tag);
    }
    const current = await tx
      .select({ tagId: highlightTags.tagId })
      .from(highlightTags)
      .where(eq(highlightTags.highlightId, highlightId));
    const currentIds = new Set(current.map((c) => c.tagId));
    const added = [...desired.values()].filter((t) => !currentIds.has(t.id));
    const removedTagIds = [...currentIds].filter((id) => !desired.has(id));

    await attachTagsToHighlight(tx, h, added, { agentName: opts.agentName });
    if (removedTagIds.length > 0) {
      await tx
        .delete(highlightTags)
        .where(and(eq(highlightTags.highlightId, highlightId), inArray(highlightTags.tagId, removedTagIds)));
    }
    const status = desired.size > 0 ? "tagged" : "needs_tags";
    const changed = added.length > 0 || removedTagIds.length > 0 || status !== h.status;
    const [highlight] = changed
      ? await tx
          .update(highlights)
          .set({ status, searchDirty: true })
          .where(and(eq(highlights.id, highlightId), eq(highlights.userId, userId)))
          .returning()
      : [h];
    return { highlight, added, removedTagIds, created };
  });
}

/** User removes one tag from a highlight. If it was the last tag, a tagged highlight goes back to needs_tags. */
export async function removeTagFromHighlight(
  db: Db,
  userId: string,
  highlightId: string,
  tagId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await loadHighlight(tx, userId, highlightId);
    const removed = await tx
      .delete(highlightTags)
      .where(and(eq(highlightTags.highlightId, highlightId), eq(highlightTags.tagId, tagId)))
      .returning({ tagId: highlightTags.tagId });
    if (removed.length === 0) throw new CoreError("not_found", "That tag is not on this highlight.");
    await afterTagsRemoved(tx, userId, [highlightId]);
  });
}

async function carrierIds(tx: DbOrTx, tagIds: string[]): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ id: highlightTags.highlightId })
    .from(highlightTags)
    .where(inArray(highlightTags.tagId, tagIds));
  return rows.map((r) => r.id);
}

/** The user accepts a proposed tag. Approving an approved tag is a no-op. */
export async function approveTag(db: Db, userId: string, tagId: string): Promise<Tag> {
  const tag = await loadTag(db, userId, tagId);
  if (tag.state === "approved") return tag;
  if (tag.state !== "proposed") {
    throw new CoreError("invalid_state", `A ${tag.state} tag can't be approved.`);
  }
  const [row] = await db
    .update(tags)
    .set({ state: "approved", approvedAt: new Date() })
    .where(and(eq(tags.id, tagId), eq(tags.userId, userId)))
    .returning();
  return row;
}

/**
 * The user declines a tag. Its row is kept (so the slug isn't proposed again on that axis),
 * its assignments are removed, and affected highlights are marked dirty.
 */
export async function rejectTag(db: Db, userId: string, tagId: string): Promise<Tag> {
  return db.transaction(async (tx) => {
    const tag = await loadTag(tx, userId, tagId);
    if (tag.state === "rejected") return tag;
    if (tag.state === "merged") throw new CoreError("invalid_state", "A merged tag can't be rejected.");
    const affected = await carrierIds(tx, [tagId]);
    await tx.delete(highlightTags).where(eq(highlightTags.tagId, tagId));
    const [row] = await tx
      .update(tags)
      .set({ state: "rejected" })
      .where(and(eq(tags.id, tagId), eq(tags.userId, userId)))
      .returning();
    await afterTagsRemoved(tx, userId, affected);
    return row;
  });
}

/** Renames a tag (display name and slug). Highlights carrying it are marked dirty. */
export async function renameTag(db: Db, userId: string, tagId: string, newName: string): Promise<Tag> {
  const { name, slug } = normalizeTagName(newName);
  return db.transaction(async (tx) => {
    const tag = await loadTag(tx, userId, tagId);
    if (!USABLE.includes(tag.state as (typeof USABLE)[number])) {
      throw new CoreError("invalid_state", `A ${tag.state} tag can't be renamed.`);
    }
    if (slug !== tag.slug) {
      const [clash] = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.userId, userId), eq(tags.axis, tag.axis), eq(tags.slug, slug)));
      if (clash) {
        throw new CoreError("tag_conflict", `A tag "${slug}" already exists on axis ${tag.axis}. Merge instead.`);
      }
    }
    const [row] = await tx
      .update(tags)
      .set({ name, slug })
      .where(and(eq(tags.id, tagId), eq(tags.userId, userId)))
      .returning();
    const carriers = await carrierIds(tx, [tagId]);
    if (carriers.length > 0) {
      await tx
        .update(highlights)
        .set({ searchDirty: true })
        .where(and(eq(highlights.userId, userId), inArray(highlights.id, carriers)));
    }
    return row;
  });
}

/**
 * Folds one or more tags into a surviving tag on the same axis. Assignments move to the target,
 * keeping the earliest `added_at` per highlight. Highlights carrying a source are marked dirty.
 */
export async function mergeTags(db: Db, userId: string, sourceIds: string[], targetId: string): Promise<Tag> {
  const uniqueSources = [...new Set(sourceIds)];
  if (uniqueSources.length === 0) throw new CoreError("invalid_input", "Name at least one tag to merge.");
  if (uniqueSources.includes(targetId)) {
    throw new CoreError("invalid_input", "A tag can't be merged into itself.");
  }
  return db.transaction(async (tx) => {
    const target = await loadTag(tx, userId, targetId);
    if (!USABLE.includes(target.state as (typeof USABLE)[number])) {
      throw new CoreError("invalid_state", `Can't merge into a ${target.state} tag.`);
    }
    const sources: Tag[] = [];
    for (const id of uniqueSources) {
      const s = await loadTag(tx, userId, id);
      if (!USABLE.includes(s.state as (typeof USABLE)[number])) {
        throw new CoreError("invalid_state", `A ${s.state} tag can't be merged.`);
      }
      if (s.axis !== target.axis) {
        throw new CoreError("invalid_input", "Tags can only be merged within one axis.");
      }
      sources.push(s);
    }
    const sourceList = sql.join(uniqueSources.map((id) => sql`${id}::uuid`), sql`, `);
    // Aggregate per highlight so two source rows can't hit the same target key twice.
    await tx.execute(sql`
      INSERT INTO highlight_tags (highlight_id, tag_id, added_at, added_by, agent_name)
      SELECT highlight_id, ${targetId}::uuid, MIN(added_at),
             (ARRAY_AGG(added_by ORDER BY added_at))[1],
             (ARRAY_AGG(agent_name ORDER BY added_at))[1]
      FROM highlight_tags
      WHERE tag_id IN (${sourceList})
      GROUP BY highlight_id
      ON CONFLICT (highlight_id, tag_id)
      DO UPDATE SET added_at = LEAST(highlight_tags.added_at, EXCLUDED.added_at)
    `);
    const affected = await carrierIds(tx, uniqueSources);
    await tx.delete(highlightTags).where(inArray(highlightTags.tagId, uniqueSources));
    // Re-point tags previously merged into a source, so merge chains never form.
    await tx
      .update(tags)
      .set({ mergedInto: targetId })
      .where(and(eq(tags.userId, userId), inArray(tags.mergedInto, uniqueSources)));
    await tx
      .update(tags)
      .set({ state: "merged", mergedInto: targetId })
      .where(and(eq(tags.userId, userId), inArray(tags.id, uniqueSources)));
    if (affected.length > 0) {
      await tx
        .update(highlights)
        .set({ searchDirty: true })
        .where(and(eq(highlights.userId, userId), inArray(highlights.id, affected)));
    }
    return target;
  });
}
