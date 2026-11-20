import { sql, type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name").notNull(),
  createdAt: createdAt(),
});

export const entries = pgTable(
  "entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull().default("song"),
    title: text("title").notNull(),
    album: text("album"),
    originalReleaseYear: integer("original_release_year"),
    durationSec: integer("duration_sec"),
    mbid: uuid("mbid"),
    mbidCandidate: uuid("mbid_candidate"),
    matchStatus: text("match_status").notNull().default("unmatched"),
    deletedAt: ts("deleted_at"),
    origin: text("origin").notNull().default("saved"),
    visibility: text("visibility").notNull().default("private"),
    schemaVersion: integer("schema_version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("entries_id_user_id_unique").on(t.id, t.userId),
    index("entries_user_created_live_idx")
      .on(t.userId, t.createdAt)
      .where(sql`${t.deletedAt} IS NULL`),
    index("entries_deleted_at_idx")
      .on(t.deletedAt)
      .where(sql`${t.deletedAt} IS NOT NULL`),
    check("entries_kind_check", sql`${t.kind} IN ('song', 'film', 'book', 'other')`),
    check("entries_duration_check", sql`${t.durationSec} IS NULL OR ${t.durationSec} > 0`),
    check(
      "entries_match_status_check",
      sql`${t.matchStatus} IN ('unmatched', 'matched', 'confirmed')`,
    ),
    check(
      "entries_match_mbid_check",
      sql`${t.matchStatus} = 'unmatched' OR ${t.mbid} IS NOT NULL`,
    ),
    check("entries_origin_check", sql`${t.origin} IN ('saved', 'suggested')`),
    check("entries_visibility_check", sql`${t.visibility} = 'private'`),
    check("entries_schema_version_check", sql`${t.schemaVersion} >= 1`),
  ],
);

export const entrySources = pgTable(
  "entry_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    rawTitle: text("raw_title"),
    rawAuthor: text("raw_author"),
    addedAt: ts("added_at").notNull().defaultNow(),
  },
  (t) => [
    unique("entry_sources_entry_type_external_unique").on(t.entryId, t.type, t.externalId),
    index("entry_sources_type_external_idx").on(t.type, t.externalId),
    check(
      "entry_sources_type_check",
      sql`${t.type} IN ('youtube', 'spotify', 'film', 'book', 'url')`,
    ),
  ],
);

// Shared reference data: no user_id.
export const artists = pgTable(
  "artists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    nameNormalized: text("name_normalized").notNull(),
    mbid: uuid("mbid"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("artists_mbid_unique").on(t.mbid),
    index("artists_name_normalized_idx").on(t.nameNormalized),
  ],
);

export const entryArtists = pgTable(
  "entry_artists",
  {
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artists.id),
    role: text("role").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    primaryKey({ name: "entry_artists_pk", columns: [t.entryId, t.artistId, t.role] }),
    index("entry_artists_artist_idx").on(t.artistId),
    check("entry_artists_role_check", sql`${t.role} IN ('primary', 'featured')`),
    check("entry_artists_position_check", sql`${t.position} >= 0`),
  ],
);

// Shared reference data: no user_id.
export const artistGenres = pgTable(
  "artist_genres",
  {
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    genre: text("genre").notNull(),
    source: text("source").notNull(),
    weight: real("weight"),
    fetchedAt: ts("fetched_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "artist_genres_pk", columns: [t.artistId, t.source, t.genre] })],
);

export const highlights = pgTable(
  "highlights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    startSec: integer("start_sec"),
    endSec: integer("end_sec"),
    note: text("note"),
    status: text("status").notNull(),
    capturedAt: ts("captured_at").notNull().defaultNow(),
    noteUpdatedAt: ts("note_updated_at"),
    searchDirty: boolean("search_dirty").notNull().default(true),
    searchSyncedAt: ts("search_synced_at"),
    visibility: text("visibility").notNull().default("private"),
    deletedAt: ts("deleted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "highlights_entry_user_fk",
      columns: [t.entryId, t.userId],
      foreignColumns: [entries.id, entries.userId],
    }).onDelete("cascade"),
    index("highlights_entry_idx").on(t.entryId),
    index("highlights_user_status_live_idx")
      .on(t.userId, t.status)
      .where(sql`${t.deletedAt} IS NULL`),
    index("highlights_user_captured_live_idx")
      .on(t.userId, t.capturedAt)
      .where(sql`${t.deletedAt} IS NULL`),
    index("highlights_user_search_dirty_idx")
      .on(t.userId)
      .where(sql`${t.searchDirty}`),
    index("highlights_deleted_at_idx")
      .on(t.deletedAt)
      .where(sql`${t.deletedAt} IS NOT NULL`),
    check("highlights_start_sec_check", sql`${t.startSec} IS NULL OR ${t.startSec} >= 0`),
    check(
      "highlights_end_sec_check",
      sql`${t.endSec} IS NULL OR (${t.startSec} IS NOT NULL AND ${t.endSec} > ${t.startSec})`,
    ),
    check(
      "highlights_status_check",
      sql`${t.status} IN ('needs_why', 'needs_tags', 'tagged')`,
    ),
    check("highlights_status_note_check", sql`(${t.status} = 'needs_why') = (${t.note} IS NULL)`),
    check(
      "highlights_note_not_blank_check",
      sql`${t.note} IS NULL OR ${t.note} ~ '[^[:space:]]'`,
    ),
    check("highlights_visibility_check", sql`${t.visibility} = 'private'`),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    axis: text("axis").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    state: text("state").notNull().default("proposed"),
    mergedInto: uuid("merged_into"),
    description: text("description"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    approvedAt: ts("approved_at"),
  },
  (t) => [
    unique("tags_user_axis_slug_unique").on(t.userId, t.axis, t.slug),
    unique("tags_id_user_id_unique").on(t.id, t.userId),
    foreignKey({
      name: "tags_merged_into_fk",
      columns: [t.mergedInto, t.userId],
      foreignColumns: [t.id, t.userId],
    }),
    index("tags_user_state_idx").on(t.userId, t.state),
    check("tags_state_check", sql`${t.state} IN ('proposed', 'approved', 'rejected', 'merged')`),
    check("tags_merged_state_check", sql`(${t.state} = 'merged') = (${t.mergedInto} IS NOT NULL)`),
    check("tags_merged_not_self_check", sql`${t.mergedInto} <> ${t.id}`),
    check("tags_created_by_check", sql`${t.createdBy} IN ('agent', 'user')`),
  ],
);

export const highlightTags = pgTable(
  "highlight_tags",
  {
    highlightId: uuid("highlight_id")
      .notNull()
      .references(() => highlights.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    addedAt: ts("added_at").notNull().defaultNow(),
    addedBy: text("added_by").notNull().default("agent"),
    agentName: text("agent_name"),
  },
  (t) => [
    primaryKey({ name: "highlight_tags_pk", columns: [t.highlightId, t.tagId] }),
    index("highlight_tags_tag_idx").on(t.tagId),
    check("highlight_tags_added_by_check", sql`${t.addedBy} IN ('agent', 'user')`),
  ],
);

export const oauthClients = pgTable("oauth_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  createdAt: createdAt(),
});

export const oauthCodes = pgTable(
  "oauth_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    codeChallenge: text("code_challenge").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("oauth_codes_expires_at_idx").on(t.expiresAt)],
);

export const oauthGrants = pgTable(
  "oauth_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    lastUsedAt: ts("last_used_at"),
  },
  (t) => [
    index("oauth_grants_user_idx").on(t.userId),
    index("oauth_grants_client_idx").on(t.clientId),
  ],
);

export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    grantId: uuid("grant_id")
      .notNull()
      .references(() => oauthGrants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
  },
  (t) => [
    index("oauth_tokens_grant_idx").on(t.grantId),
    index("oauth_tokens_expires_at_idx").on(t.expiresAt),
    check("oauth_tokens_kind_check", sql`${t.kind} IN ('access', 'refresh')`),
  ],
);

export const authAttempts = pgTable(
  "auth_attempts",
  {
    key: text("key").primaryKey(),
    fails: integer("fails").notNull().default(0),
    lockedUntil: ts("locked_until"),
  },
  (t) => [check("auth_attempts_fails_check", sql`${t.fails} >= 0`)],
);

export const settings = pgTable("settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  mcpEnabled: boolean("mcp_enabled").notNull().default(true),
  mcpAllowChanges: boolean("mcp_allow_changes").notNull().default(true),
  mcpAllowDeletes: boolean("mcp_allow_deletes").notNull().default(false),
  timeZone: text("time_zone").notNull().default("America/Toronto"),
  updatedAt: updatedAt(),
});

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;
export type Entry = InferSelectModel<typeof entries>;
export type NewEntry = InferInsertModel<typeof entries>;
export type EntrySource = InferSelectModel<typeof entrySources>;
export type NewEntrySource = InferInsertModel<typeof entrySources>;
export type Artist = InferSelectModel<typeof artists>;
export type NewArtist = InferInsertModel<typeof artists>;
export type EntryArtist = InferSelectModel<typeof entryArtists>;
export type NewEntryArtist = InferInsertModel<typeof entryArtists>;
export type ArtistGenre = InferSelectModel<typeof artistGenres>;
export type NewArtistGenre = InferInsertModel<typeof artistGenres>;
export type Highlight = InferSelectModel<typeof highlights>;
export type NewHighlight = InferInsertModel<typeof highlights>;
export type Tag = InferSelectModel<typeof tags>;
export type NewTag = InferInsertModel<typeof tags>;
export type HighlightTag = InferSelectModel<typeof highlightTags>;
export type NewHighlightTag = InferInsertModel<typeof highlightTags>;
export type OauthClient = InferSelectModel<typeof oauthClients>;
export type NewOauthClient = InferInsertModel<typeof oauthClients>;
export type OauthCode = InferSelectModel<typeof oauthCodes>;
export type NewOauthCode = InferInsertModel<typeof oauthCodes>;
export type OauthGrant = InferSelectModel<typeof oauthGrants>;
export type NewOauthGrant = InferInsertModel<typeof oauthGrants>;
export type OauthToken = InferSelectModel<typeof oauthTokens>;
export type NewOauthToken = InferInsertModel<typeof oauthTokens>;
export type AuthAttempt = InferSelectModel<typeof authAttempts>;
export type NewAuthAttempt = InferInsertModel<typeof authAttempts>;
export type Settings = InferSelectModel<typeof settings>;
export type NewSettings = InferInsertModel<typeof settings>;
