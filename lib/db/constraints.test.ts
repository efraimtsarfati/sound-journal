import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OWNER_USER_ID } from "../core/owner";
import {
  artistGenres,
  artists,
  authAttempts,
  entries,
  entryArtists,
  entrySources,
  highlightTags,
  highlights,
  oauthClients,
  oauthCodes,
  oauthGrants,
  oauthTokens,
  settings,
  tags,
  users,
} from "./schema";
import {
  createTestDb,
  expectPgError,
  insertArtist,
  insertEntry,
  insertHighlight,
  insertTag,
  insertUser,
  PG,
} from "./test-utils";

const MBID_A = "11111111-1111-4111-8111-111111111111";
const MBID_B = "22222222-2222-4222-8222-222222222222";

describe("constraints", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let db: typeof t.db;

  beforeAll(async () => {
    t = await createTestDb();
    db = t.db;
  });
  afterAll(async () => {
    await t.close();
  });

  describe("defaults", () => {
    it("applies entry defaults", async () => {
      const e = await insertEntry(db);
      expect(e).toMatchObject({
        kind: "song",
        matchStatus: "unmatched",
        origin: "saved",
        visibility: "private",
        schemaVersion: 1,
        deletedAt: null,
        mbid: null,
      });
      expect(e.createdAt).toBeInstanceOf(Date);
      expect(e.updatedAt).toBeInstanceOf(Date);
    });

    it("applies highlight defaults", async () => {
      const e = await insertEntry(db);
      const h = await insertHighlight(db, { entryId: e.id });
      expect(h).toMatchObject({
        searchDirty: true,
        visibility: "private",
        startSec: null,
        endSec: null,
        searchSyncedAt: null,
      });
      expect(h.capturedAt).toBeInstanceOf(Date);
    });

    it("applies tag and highlight_tag defaults", async () => {
      const e = await insertEntry(db);
      const h = await insertHighlight(db, { entryId: e.id });
      const tag = await insertTag(db, { slug: "defaults" });
      expect(tag.state).toBe("proposed");
      const [ht] = await db
        .insert(highlightTags)
        .values({ highlightId: h.id, tagId: tag.id })
        .returning();
      expect(ht.addedBy).toBe("agent");
      expect(ht.addedAt).toBeInstanceOf(Date);
    });

    it("applies entry_artists and auth_attempts defaults", async () => {
      const e = await insertEntry(db);
      const a = await insertArtist(db);
      const [ea] = await db
        .insert(entryArtists)
        .values({ entryId: e.id, artistId: a.id, role: "primary" })
        .returning();
      expect(ea.position).toBe(0);
      const [att] = await db.insert(authAttempts).values({ key: "defaults" }).returning();
      expect(att).toMatchObject({ fails: 0, lockedUntil: null });
    });
  });

  describe("highlight time rules", () => {
    it("allows a null start and null end", async () => {
      const e = await insertEntry(db);
      await insertHighlight(db, { entryId: e.id, startSec: null, endSec: null });
    });

    it("allows start 0 and a later end", async () => {
      const e = await insertEntry(db);
      const h = await insertHighlight(db, { entryId: e.id, startSec: 0, endSec: 10 });
      expect(h.endSec).toBe(10);
    });

    it("rejects an end without a start", async () => {
      const e = await insertEntry(db);
      await expectPgError(insertHighlight(db, { entryId: e.id, endSec: 30 }), {
        code: PG.check,
        constraint: "highlights_end_sec_check",
      });
    });

    it("rejects end equal to start and end before start", async () => {
      const e = await insertEntry(db);
      for (const endSec of [30, 20]) {
        await expectPgError(insertHighlight(db, { entryId: e.id, startSec: 30, endSec }), {
          code: PG.check,
          constraint: "highlights_end_sec_check",
        });
      }
    });

    it("rejects a negative start", async () => {
      const e = await insertEntry(db);
      await expectPgError(insertHighlight(db, { entryId: e.id, startSec: -1 }), {
        code: PG.check,
        constraint: "highlights_start_sec_check",
      });
    });
  });

  describe("note and status", () => {
    it("allows needs_why with no note", async () => {
      const e = await insertEntry(db);
      await insertHighlight(db, { entryId: e.id, status: "needs_why", note: null });
    });

    it("rejects needs_why with a note", async () => {
      const e = await insertEntry(db);
      await expectPgError(
        insertHighlight(db, { entryId: e.id, status: "needs_why", note: "has words" }),
        { code: PG.check, constraint: "highlights_status_note_check" },
      );
    });

    it("rejects needs_tags and tagged with no note", async () => {
      const e = await insertEntry(db);
      for (const status of ["needs_tags", "tagged"]) {
        await expectPgError(insertHighlight(db, { entryId: e.id, status, note: null }), {
          code: PG.check,
          constraint: "highlights_status_note_check",
        });
      }
    });

    it("rejects blank and whitespace-only notes", async () => {
      const e = await insertEntry(db);
      for (const note of ["", "   ", " \t\n "]) {
        await expectPgError(insertHighlight(db, { entryId: e.id, status: "needs_tags", note }), {
          code: PG.check,
          constraint: "highlights_note_not_blank_check",
        });
      }
    });

    it("rejects an unknown status", async () => {
      const e = await insertEntry(db);
      await expectPgError(insertHighlight(db, { entryId: e.id, status: "done" }), {
        code: PG.check,
        constraint: "highlights_status_check",
      });
    });
  });

  describe("visibility and enums", () => {
    it("rejects non-private visibility on entries and highlights", async () => {
      await expectPgError(insertEntry(db, { visibility: "public" }), {
        code: PG.check,
        constraint: "entries_visibility_check",
      });
      const e = await insertEntry(db);
      await expectPgError(insertHighlight(db, { entryId: e.id, visibility: "public" }), {
        code: PG.check,
        constraint: "highlights_visibility_check",
      });
      await expectPgError(insertHighlight(db, { entryId: e.id, visibility: "unlisted" }), {
        code: PG.check,
        constraint: "highlights_visibility_check",
      });
    });

    it("rejects bad enum values", async () => {
      const e = await insertEntry(db);
      const a = await insertArtist(db);
      await expectPgError(insertEntry(db, { kind: "podcast" }), {
        code: PG.check,
        constraint: "entries_kind_check",
      });
      await expectPgError(insertEntry(db, { origin: "imported" }), {
        code: PG.check,
        constraint: "entries_origin_check",
      });
      await expectPgError(insertEntry(db, { matchStatus: "maybe", mbid: MBID_A }), {
        code: PG.check,
        constraint: "entries_match_status_check",
      });
      await expectPgError(
        db.insert(entrySources).values({ entryId: e.id, type: "tape", externalId: "x", url: "u" }),
        { code: PG.check, constraint: "entry_sources_type_check" },
      );
      await expectPgError(
        db.insert(entryArtists).values({ entryId: e.id, artistId: a.id, role: "producer" }),
        { code: PG.check, constraint: "entry_artists_role_check" },
      );
      await expectPgError(insertTag(db, { slug: "bad-state", state: "pending" }), {
        code: PG.check,
        constraint: "tags_state_check",
      });
      await expectPgError(insertTag(db, { slug: "bad-creator", createdBy: "robot" }), {
        code: PG.check,
        constraint: "tags_created_by_check",
      });
      const h = await insertHighlight(db, { entryId: e.id });
      const tag = await insertTag(db, { slug: "bad-added-by" });
      await expectPgError(
        db.insert(highlightTags).values({ highlightId: h.id, tagId: tag.id, addedBy: "robot" }),
        { code: PG.check, constraint: "highlight_tags_added_by_check" },
      );
    });

    it("accepts the reserved documented values", async () => {
      await insertEntry(db, { kind: "film", origin: "suggested" });
      await insertTag(db, { slug: "user-made", createdBy: "user" });
    });

    it("rejects numeric violations", async () => {
      const e = await insertEntry(db);
      const a = await insertArtist(db);
      await expectPgError(insertEntry(db, { durationSec: 0 }), {
        code: PG.check,
        constraint: "entries_duration_check",
      });
      await expectPgError(insertEntry(db, { schemaVersion: 0 }), {
        code: PG.check,
        constraint: "entries_schema_version_check",
      });
      await expectPgError(
        db.insert(entryArtists).values({ entryId: e.id, artistId: a.id, role: "primary", position: -1 }),
        { code: PG.check, constraint: "entry_artists_position_check" },
      );
      await expectPgError(db.insert(authAttempts).values({ key: "neg", fails: -1 }), {
        code: PG.check,
        constraint: "auth_attempts_fails_check",
      });
    });

    it("rejects an unknown oauth token kind", async () => {
      await db.insert(oauthClients).values({ id: "c-kind", name: "Client", redirectUris: [] });
      const [g] = await db
        .insert(oauthGrants)
        .values({ clientId: "c-kind", userId: OWNER_USER_ID })
        .returning();
      await expectPgError(
        db.insert(oauthTokens).values({
          tokenHash: "h-kind",
          grantId: g.id,
          kind: "session",
          expiresAt: new Date(),
        }),
        { code: PG.check, constraint: "oauth_tokens_kind_check" },
      );
    });
  });

  describe("match status", () => {
    it("rejects matched or confirmed without an mbid", async () => {
      for (const matchStatus of ["matched", "confirmed"]) {
        await expectPgError(insertEntry(db, { matchStatus }), {
          code: PG.check,
          constraint: "entries_match_mbid_check",
        });
      }
    });

    it("allows matched and confirmed with an mbid, unmatched with a candidate only", async () => {
      await insertEntry(db, { matchStatus: "matched", mbid: MBID_A });
      await insertEntry(db, { matchStatus: "confirmed", mbid: MBID_A });
      await insertEntry(db, { matchStatus: "unmatched", mbidCandidate: MBID_B });
    });
  });

  describe("cross-user rules", () => {
    it("rejects a highlight whose user differs from its entry's user", async () => {
      const other = await insertUser(db, { displayName: "Other A" });
      const e = await insertEntry(db);
      await expectPgError(insertHighlight(db, { entryId: e.id, userId: other.id }), {
        code: PG.fk,
        constraint: "highlights_entry_user_fk",
      });
    });

    it("rejects merging a tag into another user's tag", async () => {
      const other = await insertUser(db, { displayName: "Other B" });
      const mine = await insertTag(db, { slug: "cross-user-target" });
      await expectPgError(
        insertTag(db, {
          userId: other.id,
          slug: "cross-user-source",
          state: "merged",
          mergedInto: mine.id,
        }),
        { code: PG.fk, constraint: "tags_merged_into_fk" },
      );
    });
  });

  describe("uniqueness", () => {
    it("rejects a duplicate source for the same entry, allows it on another entry", async () => {
      const e1 = await insertEntry(db);
      const e2 = await insertEntry(db);
      const src = { type: "youtube", externalId: "abc123", url: "https://example.test/watch?v=abc123" };
      await db.insert(entrySources).values({ entryId: e1.id, ...src });
      await expectPgError(db.insert(entrySources).values({ entryId: e1.id, ...src }), {
        code: PG.unique,
        constraint: "entry_sources_entry_type_external_unique",
      });
      await db.insert(entrySources).values({ entryId: e2.id, ...src });
    });

    it("makes tag slugs unique per user and axis", async () => {
      const other = await insertUser(db, { displayName: "Other C" });
      await insertTag(db, { axis: "sound", slug: "unique-slug" });
      await expectPgError(insertTag(db, { axis: "sound", slug: "unique-slug", name: "Dup" }), {
        code: PG.unique,
        constraint: "tags_user_axis_slug_unique",
      });
      await insertTag(db, { axis: "feeling", slug: "unique-slug" });
      await insertTag(db, { userId: other.id, axis: "sound", slug: "unique-slug" });
    });

    it("makes artist mbid unique but allows many NULLs", async () => {
      await insertArtist(db, { mbid: MBID_A });
      await expectPgError(insertArtist(db, { mbid: MBID_A, name: "Other" }), {
        code: PG.unique,
        constraint: "artists_mbid_unique",
      });
      await insertArtist(db, { mbid: null });
      await insertArtist(db, { mbid: null });
    });

    it("rejects duplicate entry_artists and highlight_tags keys", async () => {
      const e = await insertEntry(db);
      const a = await insertArtist(db);
      await db.insert(entryArtists).values({ entryId: e.id, artistId: a.id, role: "primary" });
      await expectPgError(
        db.insert(entryArtists).values({ entryId: e.id, artistId: a.id, role: "primary" }),
        { code: PG.unique, constraint: "entry_artists_pk" },
      );
      // Same artist in a different role is a different key.
      await db.insert(entryArtists).values({ entryId: e.id, artistId: a.id, role: "featured" });

      const h = await insertHighlight(db, { entryId: e.id });
      const tag = await insertTag(db, { slug: "pk-dup" });
      await db.insert(highlightTags).values({ highlightId: h.id, tagId: tag.id });
      await expectPgError(db.insert(highlightTags).values({ highlightId: h.id, tagId: tag.id }), {
        code: PG.unique,
        constraint: "highlight_tags_pk",
      });
    });

    it("rejects a duplicate artist_genres key", async () => {
      const a = await insertArtist(db);
      const row = { artistId: a.id, genre: "post-punk", source: "musicbrainz" };
      await db.insert(artistGenres).values(row);
      await expectPgError(db.insert(artistGenres).values(row), {
        code: PG.unique,
        constraint: "artist_genres_pk",
      });
      await db.insert(artistGenres).values({ ...row, source: "lastfm" });
    });
  });

  describe("tag merge state", () => {
    it("requires merged_into when state is merged", async () => {
      await expectPgError(insertTag(db, { slug: "merged-no-target", state: "merged" }), {
        code: PG.check,
        constraint: "tags_merged_state_check",
      });
    });

    it("rejects merged_into on a non-merged tag", async () => {
      const target = await insertTag(db, { slug: "target-a" });
      await expectPgError(
        insertTag(db, { slug: "not-merged", state: "approved", mergedInto: target.id }),
        { code: PG.check, constraint: "tags_merged_state_check" },
      );
    });

    it("rejects merging a tag into itself", async () => {
      const tag = await insertTag(db, { slug: "self-merge" });
      await expectPgError(
        db.update(tags).set({ state: "merged", mergedInto: tag.id }).where(eq(tags.id, tag.id)),
        { code: PG.check, constraint: "tags_merged_not_self_check" },
      );
    });

    it("allows a valid merge", async () => {
      const target = await insertTag(db, { slug: "target-b" });
      const src = await insertTag(db, { slug: "source-b", state: "merged", mergedInto: target.id });
      expect(src.mergedInto).toBe(target.id);
    });

    it("the merge pattern keeps the earliest added_at", async () => {
      const e = await insertEntry(db);
      const h = await insertHighlight(db, { entryId: e.id });
      const target = await insertTag(db, { slug: "merge-target" });
      const source = await insertTag(db, { slug: "merge-source" });
      const early = new Date("2024-01-01T00:00:00Z");
      const late = new Date("2024-06-01T00:00:00Z");
      await db.insert(highlightTags).values([
        { highlightId: h.id, tagId: source.id, addedAt: early },
        { highlightId: h.id, tagId: target.id, addedAt: late },
      ]);
      await db.execute(sql`
        INSERT INTO highlight_tags (highlight_id, tag_id, added_at, added_by, agent_name)
        SELECT highlight_id, ${target.id}::uuid, added_at, added_by, agent_name
        FROM highlight_tags WHERE tag_id = ${source.id}
        ON CONFLICT (highlight_id, tag_id)
        DO UPDATE SET added_at = LEAST(highlight_tags.added_at, EXCLUDED.added_at)`);
      await db.delete(highlightTags).where(eq(highlightTags.tagId, source.id));
      const rows = await db.select().from(highlightTags).where(eq(highlightTags.highlightId, h.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].tagId).toBe(target.id);
      expect(rows[0].addedAt).toEqual(early);
    });
  });

  describe("cascades and restrictions", () => {
    it("purging an entry removes its sources, artist links, highlights and highlight tags", async () => {
      const e = await insertEntry(db);
      const a = await insertArtist(db);
      const tag = await insertTag(db, { slug: "cascade-entry" });
      await db
        .insert(entrySources)
        .values({ entryId: e.id, type: "youtube", externalId: "casc1", url: "https://example.test/c" });
      await db.insert(entryArtists).values({ entryId: e.id, artistId: a.id, role: "primary" });
      const h = await insertHighlight(db, { entryId: e.id });
      await db.insert(highlightTags).values({ highlightId: h.id, tagId: tag.id });

      await db.delete(entries).where(eq(entries.id, e.id));

      expect(await db.select().from(entrySources).where(eq(entrySources.entryId, e.id))).toHaveLength(0);
      expect(await db.select().from(entryArtists).where(eq(entryArtists.entryId, e.id))).toHaveLength(0);
      expect(await db.select().from(highlights).where(eq(highlights.entryId, e.id))).toHaveLength(0);
      expect(await db.select().from(highlightTags).where(eq(highlightTags.highlightId, h.id))).toHaveLength(0);
      // Shared and vocabulary rows survive.
      expect(await db.select().from(artists).where(eq(artists.id, a.id))).toHaveLength(1);
      expect(await db.select().from(tags).where(eq(tags.id, tag.id))).toHaveLength(1);
    });

    it("deleting a tag removes its highlight_tags rows", async () => {
      const e = await insertEntry(db);
      const h = await insertHighlight(db, { entryId: e.id });
      const tag = await insertTag(db, { slug: "cascade-tag" });
      await db.insert(highlightTags).values({ highlightId: h.id, tagId: tag.id });
      await db.delete(tags).where(eq(tags.id, tag.id));
      expect(await db.select().from(highlightTags).where(eq(highlightTags.highlightId, h.id))).toHaveLength(0);
    });

    it("deleting a grant removes its tokens", async () => {
      await db.insert(oauthClients).values({ id: "c-grant", name: "Client", redirectUris: ["https://example.test/cb"] });
      const [g] = await db
        .insert(oauthGrants)
        .values({ clientId: "c-grant", userId: OWNER_USER_ID })
        .returning();
      await db.insert(oauthTokens).values([
        { tokenHash: "h-access", grantId: g.id, kind: "access", expiresAt: new Date() },
        { tokenHash: "h-refresh", grantId: g.id, kind: "refresh", expiresAt: new Date() },
      ]);
      await db.delete(oauthGrants).where(eq(oauthGrants.id, g.id));
      expect(await db.select().from(oauthTokens).where(eq(oauthTokens.grantId, g.id))).toHaveLength(0);
    });

    it("deleting a client removes its codes, grants and their tokens", async () => {
      await db.insert(oauthClients).values({ id: "c-all", name: "Client", redirectUris: [] });
      await db.insert(oauthCodes).values({
        codeHash: "code-all",
        clientId: "c-all",
        userId: OWNER_USER_ID,
        codeChallenge: "challenge",
        redirectUri: "https://example.test/cb",
        expiresAt: new Date(),
      });
      const [g] = await db
        .insert(oauthGrants)
        .values({ clientId: "c-all", userId: OWNER_USER_ID })
        .returning();
      await db
        .insert(oauthTokens)
        .values({ tokenHash: "tok-all", grantId: g.id, kind: "access", expiresAt: new Date() });

      await db.delete(oauthClients).where(eq(oauthClients.id, "c-all"));

      expect(await db.select().from(oauthCodes).where(eq(oauthCodes.clientId, "c-all"))).toHaveLength(0);
      expect(await db.select().from(oauthGrants).where(eq(oauthGrants.clientId, "c-all"))).toHaveLength(0);
      expect(await db.select().from(oauthTokens).where(eq(oauthTokens.tokenHash, "tok-all"))).toHaveLength(0);
    });

    it("deleting an artist removes its genres", async () => {
      const a = await insertArtist(db);
      await db.insert(artistGenres).values({ artistId: a.id, genre: "dream pop", source: "musicbrainz" });
      await db.delete(artists).where(eq(artists.id, a.id));
      expect(await db.select().from(artistGenres).where(eq(artistGenres.artistId, a.id))).toHaveLength(0);
    });

    it("refuses to delete a user who still has entries", async () => {
      const u = await insertUser(db, { displayName: "Has Entries" });
      await insertEntry(db, { userId: u.id });
      await expectPgError(db.delete(users).where(eq(users.id, u.id)), { code: PG.fk });
    });

    it("refuses to delete a user who still has settings", async () => {
      await expectPgError(db.delete(users).where(eq(users.id, OWNER_USER_ID)), { code: PG.fk });
    });

    it("refuses to delete an artist linked to an entry", async () => {
      const e = await insertEntry(db);
      const a = await insertArtist(db);
      await db.insert(entryArtists).values({ entryId: e.id, artistId: a.id, role: "primary" });
      await expectPgError(db.delete(artists).where(eq(artists.id, a.id)), { code: PG.fk });
    });

    it("rejects an entry for a missing user", async () => {
      await expectPgError(insertEntry(db, { userId: "99999999-9999-4999-8999-999999999999" }), {
        code: PG.fk,
        constraint: "entries_user_id_users_id_fk",
      });
    });

    it("rejects settings for a missing user", async () => {
      await expectPgError(
        db.insert(settings).values({ userId: "99999999-9999-4999-8999-999999999999" }),
        { code: PG.fk },
      );
    });
  });

  describe("updated_at", () => {
    it("is set by Drizzle on update", async () => {
      const e = await insertEntry(db);
      await new Promise((r) => setTimeout(r, 5));
      const [updated] = await db
        .update(entries)
        .set({ title: "Renamed" })
        .where(and(eq(entries.id, e.id), eq(entries.userId, OWNER_USER_ID)))
        .returning();
      expect(updated.updatedAt.getTime()).toBeGreaterThan(e.updatedAt.getTime());
    });
  });
});
