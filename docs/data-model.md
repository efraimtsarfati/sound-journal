# Data model

Postgres (Neon) is the source of truth. The vector index is derived and rebuildable. Names below are the intended table and column names; types are Postgres types.

## Entity overview

```
users ─┬─< entries ─┬─< entry_sources        (where it can be played: YouTube, later Spotify…)
       │            ├─< entry_artists >── artists ──< artist_genres   (external genre layer)
       │            └─< highlights ──< highlight_tags >── tags
       └─< tags  (the user's vocabulary, each on one taxonomy axis)
```

- **Entry** — one work in the journal: a song (v1), later a film or book. Belongs to a user.
- **Highlight** — a moment in an entry (or the whole entry) plus the user's note. **Tags live here.**
- **Tag** — a word or phrase in the user's vocabulary, on exactly one taxonomy axis.
- **Artist** — a performer, stored once and shared across entries (and later across users).

## Tables

### `users`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| display_name | text | |
| created_at | timestamptz | |

V1 has one row (the owner). The table exists so every other row can carry `user_id` from day one.

### `entries`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | every query filters by this |
| kind | text | `song` in v1; reserved: `film`, `book`, `other` |
| title | text | cleaned title ("Leave Me Alone"), not the raw YouTube title |
| album | text null | |
| original_release_year | int null | original release, not a remaster's year |
| duration_sec | int null | |
| mbid | uuid null | MusicBrainz recording ID (set when `matched` or `confirmed`) |
| mbid_candidate | uuid null | a low-confidence match waiting for the user to confirm |
| match_status | text | `unmatched` · `matched` · `confirmed` |
| deleted_at | timestamptz null | soft delete; purged after 30 days |
| origin | text | `saved` in v1; reserved: `suggested` (discovery loop) |
| visibility | text | `private` only in v1; reserved: `unlisted`, `public` |
| schema_version | int | bumped when the shape of an entry changes; migrations upgrade old rows |
| created_at, updated_at | timestamptz | |

### `entry_sources`
Where an entry can be played or read. One entry can have several (YouTube now, Spotify later).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| entry_id | uuid FK → entries | |
| type | text | `youtube` in v1; reserved: `spotify`, `film`, `book`, `url` |
| external_id | text | YouTube video ID; Spotify track ID; ISBN… |
| url | text | canonical link |
| raw_title | text null | title as the source reported it ("New Order - Leave Me Alone (Official Audio)") |
| raw_author | text null | channel or uploader |
| added_at | timestamptz | |

Unique: `(entry_id, type, external_id)`. Duplicate detection looks up `(user_id, type, external_id)` through `entries`.

**Time offsets are source-specific.** A highlight's timestamps are measured on the entry's *primary* source (the first one added). If a second source has a different intro length, an offset can be stored later (`offset_sec`, reserved, not in v1).

### `artists`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | |
| name_normalized | text | lowercased, accents and punctuation stripped, leading "the" removed — used to deduplicate |
| mbid | uuid null unique | MusicBrainz artist ID |
| created_at | timestamptz | |

Artists are facts about the world, not about a user, so **`artists` and `artist_genres` are the one exception to user scoping** — they are shared reference data and hold nothing personal. Members, credits and labels are **not stored** — they're fetched from MusicBrainz by `mbid` when needed.

**Deduplication:** an artist with an `mbid` is unique by `mbid`. An artist without one is matched by `name_normalized`; when an `mbid` is later found, rows with the same `mbid` are merged (entry links move to the surviving row).

### `entry_artists`
| Column | Type | Notes |
|---|---|---|
| entry_id | uuid FK | |
| artist_id | uuid FK | |
| role | text | `primary` · `featured` |
| position | int | display order |

Primary key: `(entry_id, artist_id, role)`.

### `artist_genres` — the external genre layer
Kept separate from the user's tags on purpose: genre describes the artist; tags describe what the user heard.

| Column | Type | Notes |
|---|---|---|
| artist_id | uuid FK | |
| genre | text | e.g. `post-punk` |
| source | text | `musicbrainz` (later possibly `lastfm`) |
| weight | real null | the source's vote count or relevance, if given |
| fetched_at | timestamptz | refresh when stale |

### `highlights`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| entry_id | uuid FK → entries | |
| user_id | uuid FK → users | denormalized for scoped queries |
| start_sec | int null | null = the whole work |
| end_sec | int null | optional; must be > start_sec |
| note | text null | the user's "why", verbatim. Null/empty → `needs_why` |
| status | text | `needs_why` · `needs_tags` · `tagged` |
| captured_at | timestamptz | **when the user saved it** — the date the taste map uses |
| note_updated_at | timestamptz null | |
| search_dirty | boolean | true when the vector copy is out of date (see [search sync](architecture.md#search-sync)) |
| search_synced_at | timestamptz null | last successful sync |
| visibility | text | `private` only in v1 |
| deleted_at | timestamptz null | soft delete; purged after 30 days |
| created_at, updated_at | timestamptz | |

Rules:
- **Every live entry has at least one live highlight.** Saving a whole song creates one highlight with `start_sec = null`. Deleting the last highlight of an entry is refused; delete the entry instead.
- A whole-work highlight (`start_sec = null`) can coexist with timestamped highlights on the same entry.
- `end_sec` requires `start_sec`, and `end_sec > start_sec` (database check constraints).

### `tags` — the user's vocabulary
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | vocabulary is per user |
| axis | text | one of the axes in `taxonomy/axes.json` |
| name | text | display form: `interlocking guitars` |
| slug | text | `interlocking-guitars`; unique per `(user_id, axis, slug)` |
| state | text | `proposed` · `approved` · `rejected` · `merged` |
| merged_into | uuid null FK → tags | set when state = `merged` |
| description | text null | optional definition, useful for the agent |
| created_by | text | `agent` in v1; `user` reserved for manual tagging later |
| created_at | timestamptz | |
| approved_at | timestamptz null | |

### `highlight_tags`
| Column | Type | Notes |
|---|---|---|
| highlight_id | uuid FK | |
| tag_id | uuid FK | |
| added_at | timestamptz | **when the tag was attached** (may be days after `captured_at`). Never reset when other tags on the highlight change |
| added_by | text | `agent` in v1; `user` reserved |
| agent_name | text null | which client added it (from the OAuth client name) |

Primary key: `(highlight_id, tag_id)`. Merging tags moves assignments with `INSERT … ON CONFLICT (highlight_id, tag_id) DO UPDATE SET added_at = LEAST(highlight_tags.added_at, EXCLUDED.added_at)`, keeping the earliest `added_at` (plain `DO NOTHING` would keep the target row's date, not the earliest).

**Who tags in v1:** the agent assigns tags. The user, in the web app, reviews proposed tags (approve, rename, merge, reject) and can remove a tag from a highlight. Manual tag *adding* by the user is reserved for later.

## Statuses

### Highlight workflow (`highlights.status`)
```
            add note              agent tags
needs_why ───────────► needs_tags ───────────► tagged
    ▲                       ▲                     │
    └──── note cleared ─────┴──── note edited ────┘
```
Transition rules (enforced in `lib/core`, covered by tests):

| Event | From | To | Tags |
|---|---|---|---|
| Save with no note | — | `needs_why` | none |
| Save with a note | — | `needs_tags` | none |
| Note added | `needs_why` | `needs_tags` | kept |
| Note edited | `tagged` | `needs_tags` | kept; the agent reviews them against the new note (keeps, adds, removes) |
| Note cleared | any | `needs_why` | kept but ignored until a note exists again |
| Agent sets tags | `needs_tags` or `tagged` | `tagged` | diffed (see `set_highlight_tags`) |
| Agent sets tags | `needs_why` | refused | — |
| Last tag removed (user removal, tag rejected or merged away) | `tagged` | `needs_tags` | none |

- Status is **workflow**, never a tag. It never appears in music searches or the taste map.

### Tag lifecycle (`tags.state`)
- `proposed` — created by the agent for a concept no existing tag covers. Usable immediately, shown with a "proposed" marker.
- `approved` — the user accepted it (or the user created it).
- `rejected` — the user declined it; its `highlight_tags` rows are removed; the agent won't propose the same slug again.
- `merged` — folded into another tag; assignments move to `merged_into`.

### Entry metadata match (`entries.match_status`)
- `unmatched` — not yet matched to MusicBrainz, or the match was uncertain.
- `matched` — matched automatically with high confidence.
- `confirmed` — the user confirmed the match.

## Extension points (reserved now, used later)

| Reserved | Enables | Cost now |
|---|---|---|
| `user_id` everywhere | multiple users, public boards | one column + scoped queries |
| `entries.kind` | films, books | one column |
| `entry_sources.type` | Spotify capture, film/book sources | one column |
| `entries.origin` | discovery loop (`suggested` entries in a `to_listen` state) | one column |
| `visibility` | public/unlisted boards and highlights | one column, constrained to `private` in v1 |
| `schema_version` | safe evolution of entry shape | one column |
| `tags.axis` | taste map balance by axis; new axes | one column |
| `captured_at` vs `added_at` | taste over time vs taxonomy over time | two timestamps |
| `artists.mbid` / `entries.mbid` | credits, members, gear research, genre refresh | IDs only |

Not reserved (would be added by migration when the feature is built): boards, follows, suggestions feedback, offsets per source, user-added tags in the UI.

## Auth and settings tables

The macro-log pattern stores auth state in Redis with expiry times. Here it lives in Postgres, with an `expires_at` column and a daily cleanup job (`/api/cron/cleanup`) that deletes expired rows. **None of these tables are included in exports.**

| Table | Holds | Key columns |
|---|---|---|
| `oauth_clients` | Dynamically registered MCP clients | `id`, `name`, `redirect_uris`, `created_at` |
| `oauth_codes` | Authorization codes (60-second life) | `code_hash` PK, `client_id`, `user_id`, `code_challenge`, `redirect_uri`, `expires_at` |
| `oauth_grants` | One per connected app; deleting it revokes all its tokens | `id`, `client_id`, `user_id`, `created_at`, `last_used_at` |
| `oauth_tokens` | Access (1 hour) and refresh (90 days) tokens, stored only as SHA-256 hashes | `token_hash` PK, `grant_id`, `kind` (`access`/`refresh`), `expires_at`, `used_at` (refresh rotation) |
| `auth_attempts` | Failed login/PIN attempts for lockout | `key` (e.g. `login`, `pin`), `fails`, `locked_until` |
| `settings` | Per-user settings, including connector switches and time zone | `user_id` PK, `mcp_enabled`, `mcp_allow_changes`, `mcp_allow_deletes`, `time_zone` (default `America/Toronto`) |

## Constraints and defaults (decided in M2a)

Enumerated text columns are `text` with a named CHECK (`<table>_<what>_check`), not Postgres enums, so adding a value is a one-line migration.

1. **Reserved values are allowed by the database; `lib/core` accepts v1 values only.** `visibility` is the exception: the CHECK allows `private` only.
2. **`tags.axis` has no database check.** M2b validates it against `taxonomy/axes.json`.
3. **`artist_genres` primary key** is `(artist_id, source, genre)`.
4. **Settings defaults:** `mcp_enabled` true, `mcp_allow_changes` true, `mcp_allow_deletes` false, `time_zone` `America/Toronto`.
5. **The first migration seeds** the owner's `users` row (`display_name` `Owner`, NOT NULL) and its `settings` row, with `ON CONFLICT DO NOTHING`.
6. **`auth_attempts` and the OAuth tables hold only the columns documented above.** M3 and M5a extend them by migration.
7. **Highlight note/status rule is a CHECK:** `status = 'needs_why'` exactly when `note IS NULL`, and a note is never blank. `lib/core` stores blank notes as NULL.
8. **`entries.match_status` of `matched` or `confirmed` requires `mbid`** (one-way: an `unmatched` entry may still have an `mbid_candidate`).
9. **Cross-user integrity:** `highlights (entry_id, user_id)` is a composite FK to `entries (id, user_id)`; `tags.merged_into` is a composite FK to `tags (id, user_id)`. The same check for `highlight_tags` (tag and highlight belong to one user) lives in `lib/core` and is tested in M2b.
10. **`updated_at`** is maintained by Drizzle's `$onUpdate`, so writes must go through Drizzle.
11. **Deletes:** purging an entry cascades to its sources, artist links and highlights; highlights cascade to `highlight_tags`; OAuth grants cascade to tokens and clients to codes and grants. Foreign keys to `users`, and from `entry_artists` to `artists`, restrict (no hard user delete in v1).
12. **Rejected tags keep their rows** (so the agent won't re-propose the slug). Whether the repeat check is per axis or global is an M2b question.
13. **Purge of soft-deleted rows after 30 days** has no slice yet; it is listed as a follow-up in the build plan.

## The owner (single-user v1)

The first migration seeds one `users` row (display name `Owner`) with a fixed UUID, exported as `OWNER_USER_ID` from `lib/core/owner.ts`. A valid web session and a valid OAuth token both resolve to that ID in v1. When real accounts arrive, sessions and tokens resolve to their own user instead — callers of `lib/core` don't change.

## Time

All timestamps are stored in UTC. Month buckets (taste map) and date filters use the user's `settings.time_zone`.

## Derived data (not stored as tables)

- **Taste map:** tag counts by axis, tag co-occurrence on the same highlight, and counts by month from `captured_at`. Computed on read.
- **Inbox:** highlights where status is `needs_why` or `needs_tags`.
- **Vector index:** one vector per highlight; see [architecture.md](architecture.md#search-sync).

## Export

`GET /api/export` returns all of the user's rows as JSON (entries, sources, artists referenced, highlights, tags, highlight_tags, including soft-deleted rows not yet purged). Auth tables are excluded. This is the backup format and the basis for any future import.
