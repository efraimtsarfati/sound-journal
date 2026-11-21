# M2a plan: Drizzle schema, first migration with owner seed, PGlite test harness

Branch `feat/m2a-schema`. Agent: `db-schema`. Docs: data-model (all), architecture (Environments). Owner approved using the proposed defaults below (section 9), recorded in `docs/data-model.md`.

## 1. Dependencies (all listed in architecture → Stack)
- dependencies: `drizzle-orm` ^0.45.4, `@neondatabase/serverless` ^1.2.1
- devDependencies: `drizzle-kit` ^0.31.11, `@electric-sql/pglite` ^0.5.17
- Do not add `dotenv` (use `process.loadEnvFile(".env.local")`), `pg`, `postgres`, `ws`. If `drizzle-kit migrate` on Vercel needs a WebSocket, stop and ask before adding `ws` (fallback: `scripts/migrate.mts` with `drizzle-orm/neon-serverless/migrator`).
- Add `"engines": { "node": "24.x" }`.

## 2. Files
- `package.json`: scripts `db:generate`, `db:migrate`, `db:check`; `vercel-build` = `drizzle-kit migrate && next build`.
- `drizzle.config.ts`: loads `.env.local` in try/catch; dialect postgresql; schema `./lib/db/schema.ts`; out `./lib/db/migrations`; strict; `dbCredentials.url` only when set; URL = `DATABASE_URL_UNPOOLED ?? DATABASE_URL`.
- `lib/core/owner.ts`: `OWNER_USER_ID = "00000000-0000-4000-8000-000000000001"`.
- `lib/db/schema.ts`: 15 tables, explicit snake_case names, inferred types exported.
- `lib/db/client.ts`: lazy `getDb()` (neon-serverless Pool, never connects at import; clear error if no `DATABASE_URL`); export `Db`/`DbOrTx` types. `lib/db/index.ts` re-exports.
- `lib/db/migrations/0000_init.sql` (+ meta) generated with `--name init`, seed appended.
- `lib/db/test-utils.ts` (PGlite harness), `lib/db/migrations.test.ts`, `lib/db/constraints.test.ts`.
- `vitest.config.mts`: `testTimeout 15000`, `hookTimeout 30000`.
- `eslint.config.mjs`: `no-restricted-imports` outside `lib/db/**` for `@neondatabase/*`, `@electric-sql/pglite*`, `drizzle-orm/neon-*`, `drizzle-orm/pglite*`, `pg`, `postgres`.
- `.github/workflows/ci.yml`: step "Migrations match the schema": `npx drizzle-kit generate && test -z "$(git status --porcelain lib/db/migrations)"`.
- `.gitattributes`: `lib/db/migrations/** text eol=lf`. `.env.example`: add `DATABASE_URL_UNPOOLED=`.

## 3. Schema
Conventions: uuid PK `defaultRandom()`; timestamps `withTimezone`; `created_at` NOT NULL DEFAULT now(); `updated_at` with `$onUpdate`; enumerated text = `text({enum})` + named CHECK `<table>_<what>_check` (no Postgres enums).

- **users**: id, display_name NOT NULL, created_at.
- **entries**: id, user_id→users, kind (`song|film|book|other`, default song), title, album, original_release_year, duration_sec (>0 or null), mbid, mbid_candidate (uuid), match_status (default unmatched; matched/confirmed requires mbid), deleted_at, origin (`saved|suggested`, default saved), visibility (CHECK = 'private'), schema_version (>=1, default 1), created_at, updated_at. Unique (id, user_id). Indexes: (user_id, created_at) WHERE deleted_at IS NULL; (deleted_at) WHERE NOT NULL.
- **entry_sources**: id, entry_id→entries CASCADE, type (`youtube|spotify|film|book|url`), external_id, url, raw_title, raw_author, added_at. Unique (entry_id,type,external_id); index (type, external_id).
- **artists** (shared): id, name, name_normalized, mbid uuid UNIQUE, created_at; index on name_normalized (not unique).
- **entry_artists**: entry_id→entries CASCADE, artist_id→artists, role (`primary|featured`), position>=0 default 0; PK (entry_id, artist_id, role); index (artist_id).
- **artist_genres** (shared): artist_id→artists CASCADE, genre, source, weight real, fetched_at; PK (artist_id, source, genre).
- **highlights**: id, entry_id, user_id→users, start_sec (>=0 or null), end_sec (null or start not null and end>start), note, status (no default; `needs_why|needs_tags|tagged`), captured_at, note_updated_at, search_dirty default true, search_synced_at, visibility 'private', deleted_at, created_at, updated_at. Composite FK (entry_id,user_id)→entries(id,user_id) CASCADE. CHECK `(status='needs_why') = (note IS NULL)`; note not blank (`note ~ '[^[:space:]]'`, POSIX class). Indexes: (entry_id); (user_id,status) WHERE deleted_at IS NULL; (user_id,captured_at) WHERE deleted_at IS NULL; (user_id) WHERE search_dirty; (deleted_at) WHERE NOT NULL.
- **tags**: id, user_id→users, axis (no DB check), name, slug, state (default proposed), merged_into, description, created_by (`agent|user`, no default), created_at, approved_at. Unique (user_id,axis,slug); unique (id,user_id); composite FK (merged_into,user_id)→tags(id,user_id); CHECK `(state='merged') = (merged_into IS NOT NULL)`; CHECK merged_into <> id; index (user_id,state).
- **highlight_tags**: highlight_id→highlights CASCADE, tag_id→tags CASCADE, added_at, added_by (`agent|user`), agent_name; PK (highlight_id, tag_id); index (tag_id).
- **oauth_clients**: id text PK, name, redirect_uris text[], created_at.
- **oauth_codes**: code_hash text PK, client_id→clients CASCADE, user_id→users, code_challenge, redirect_uri, expires_at; index (expires_at).
- **oauth_grants**: id, client_id→clients CASCADE, user_id→users, created_at, last_used_at; indexes (user_id),(client_id).
- **oauth_tokens**: token_hash text PK, grant_id→grants CASCADE, kind (`access|refresh`), expires_at, used_at; indexes (grant_id),(expires_at).
- **auth_attempts**: key text PK, fails int default 0 (>=0), locked_until.
- **settings**: user_id PK→users, mcp_enabled true, mcp_allow_changes true, mcp_allow_deletes false, time_zone 'America/Toronto', updated_at.

User FKs are no action (no hard user delete in v1).

## 4. Migration and seed
Generate `0000_init`, review SQL by hand, append (after `--> statement-breakpoint`) idempotent inserts: owner `users` row (display_name 'Owner') and its `settings` row, `ON CONFLICT DO NOTHING`. Run `db:check`; re-run `db:generate` must report no changes.

## 5. PGlite harness
`createTestDb()` → `{db, client, close}`: in-memory PGlite, drizzle with schema, migrate from `lib/db/migrations` each time. One DB per test file. Helpers: `expectPgError(promise, {code, constraint})` (read `err.code ?? err.cause?.code`; 23514 check, 23505 unique, 23503 FK), fixture inserters with made-up data.

## 6. Tests
- migrations: exactly the 15 tables; one owner row with id OWNER_USER_ID and name 'Owner'; settings row and defaults; re-migrate is a no-op; two DBs isolated; OWNER_USER_ID is a valid v4 UUID.
- constraints: defaults; highlight time rules (null start ok, end without start, end<=start, negative start rejected); note/status rule and blank note; visibility 'public' rejected (entries, highlights); bad enum values; matched without mbid; cross-user highlight and cross-user merge rejected; uniques (sources, tags per axis/user, artist mbid with multiple NULLs, entry_artists and highlight_tags PKs); merge-state checks; merge pattern keeps earliest `added_at`; cascades (entry purge, grant→tokens, client→codes/grants); restrictions (user with entries, linked artist); entry for missing user.
- Run `npm run typecheck && npm run lint && npm test && npm run build`.

## 9. Decisions (owner-approved defaults; record in data-model.md)
1. DB CHECKs allow all documented values including reserved ones; `lib/core` accepts v1 values only. `visibility` = 'private' only.
2. No DB check on `tags.axis`; M2b validates against `taxonomy/axes.json`.
3. `artist_genres` PK (artist_id, source, genre).
4. Settings defaults: enabled true, allow changes true, allow deletes false.
5. Seed owner's `settings` row in first migration.
6. `auth_attempts` has documented columns only; M3 extends.
7. OAuth tables have key columns only; M5a extends.
8. Note/status invariant is a DB CHECK; M2b stores blank notes as NULL.
9. matched/confirmed requires mbid (one-way).
10. `highlight_tags` cross-user check is in `lib/core` (M2b tests it).
11. `updated_at` via drizzle `$onUpdate`; M2b updates through drizzle.
12. Migrations prefer `DATABASE_URL_UNPOOLED`, fall back to `DATABASE_URL`.
13. Runtime driver: neon-serverless Pool (interactive transactions).
14. 30-day purge of soft-deleted rows has no slice yet: note it in the build plan as a follow-up.
15. Rejected tags keep their rows; slug-repeat check scope (per axis or global) is an M2b question.
16. `users.display_name` NOT NULL, seeded 'Owner'.
17. Fix doc drift: M1 row in build-plan still says ◐.

Docs to update in the same PR: data-model (values, defaults, FKs, checks, PKs, ON DELETE, settings, owner name), architecture (unpooled URL, neon-serverless driver, Node 24), CONTRIBUTING (db scripts, drift check, seeds), build-plan (status), CHANGELOG only if user-visible (it isn't).
