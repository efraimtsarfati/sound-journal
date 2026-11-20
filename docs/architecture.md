# Architecture

## Overview

```
 Phone / laptop browser                 Owner's agent (Claude, or any MCP client)
   capture, browse, play,                 voice capture, tagging, metadata matching,
   approve tags, search                   discovery, "how do I play this?"
          │  HTTPS (session cookie)                   │  MCP over HTTPS (OAuth bearer token)
          ▼                                           ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │  Next.js app on Vercel                                               │
 │                                                                      │
 │   app/ (pages)      app/api/* (web routes)      app/api/mcp (MCP)    │
 │          └───────────────┬─────────────────────────────┘             │
 │                          ▼                                           │
 │                  lib/core  (domain logic — the only place rules live)│
 │                          │                                           │
 │        ┌─────────────────┼──────────────────┬───────────────┐        │
 │        ▼                 ▼                  ▼               ▼        │
 │   lib/db           lib/search          lib/sources     lib/metadata  │
 │   (Postgres)       (vector index)      (YouTube…)      (MusicBrainz) │
 └────────┼─────────────────┼──────────────────┼───────────────┼────────┘
          ▼                 ▼                  ▼               ▼
     Neon Postgres     Upstash Vector     YouTube oEmbed    MusicBrainz API
     (entries, tags…)  (hosted embedding    + IFrame player
                        model)
```

## Stack

| Concern | Choice | Why |
|---|---|---|
| App framework | Next.js (App Router), TypeScript | Same as macro-log; one codebase for pages, API routes and the MCP endpoint |
| Styling | Tailwind CSS | Same as macro-log |
| Hosting | Vercel (Hobby), the same account as macro-log, as a separate project | Free, preview deployment per pull request |
| Primary database | Neon Postgres (Free), via Vercel Marketplace | Relational model (entries → highlights → tags) fits SQL; Upstash Redis free tier allows only one database and macro-log uses it. See [ADR 0001](decisions/0001-postgres-for-primary-data.md) |
| Query/migrations | Drizzle ORM + drizzle-kit; `@neondatabase/serverless` driver in deployed code | Typed queries, SQL migrations checked into git |
| Test database | PGlite (`@electric-sql/pglite`, Postgres compiled to WebAssembly) | Real Postgres in unit tests and CI with no server and no secrets — works for PRs from forks |
| Validation | `zod` | Input schemas for API routes and MCP tools |
| Meaning search | Upstash Vector (Free) with a hosted embedding model, via `@upstash/vector` | Embeds raw text server-side, so no embedding API key. See [ADR 0003](decisions/0003-hosted-embeddings.md) |
| AI | None in the app. The user's agent connects through MCP | Free, user chooses their AI. See [ADR 0002](decisions/0002-bring-your-own-agent.md) |
| MCP | `mcp-handler` + `@modelcontextprotocol/sdk`, OAuth 2.1 + DCR | Pattern proven in macro-log |
| Media source (v1) | YouTube: oEmbed for metadata (no key), IFrame Player API for playback/timestamps | Works for anyone; Spotify's API is restricted for new apps. See [ADR 0004](decisions/0004-youtube-first-sources.md) |
| Music metadata | MusicBrainz (free, open) | IDs that unlock credits, members, genres later |
| Tests | Vitest | Fast unit tests for `lib/core` |
| CI | GitHub Actions | Typecheck, lint, test, build on every PR |

Exact package versions are pinned when the skeleton is created (milestone M1). Adding any dependency not listed here needs a note in the PR description explaining why.

## Layering rules

These rules are what make the app extendable without rewrites. They are enforced in review.

1. **`lib/core` is the only place business rules live.** Adding a highlight, changing status, tagging, approving tags, matching metadata — all are functions in `lib/core`. Pages, web API routes and MCP tools are thin wrappers that validate input, call `lib/core`, and format output.
2. **Only `lib/db` talks to Postgres. Only `lib/search` talks to the vector index.** Nothing else imports a database client.
3. **External services sit behind adapters.** `lib/sources/youtube.ts`, later `lib/sources/spotify.ts`; `lib/metadata/musicbrainz.ts`. Core code depends on the adapter interface, not the service.
4. **Every query on personal data is scoped by `user_id`**, even though v1 has one user. `lib/db` functions take the user ID as a required argument. The only exception is shared reference data (`artists`, `artist_genres`), which holds nothing personal.
5. **No secrets in code or in the repo.** Environment variables only; names listed in `.env.example`.

Why it matters: the web app and the MCP server are two interfaces over the same core. Adding a third (a browser extension, a share-sheet shortcut, a bot) means writing a new thin wrapper, not a new app.

## Key flows

### Save from the web app
1. User pastes a YouTube URL (`youtube.com/watch`, `youtu.be`, `music.youtube.com`, with or without `t=`) → `lib/sources/youtube` parses the video ID and any `t=` start time, and fetches oEmbed (title, channel).
2. Initial title and artist are derived from the raw title: split on " - " (artist – title), strip common suffixes ("Official Audio", "Official Video", "Lyrics", "Remastered", bracketed years), and treat a "<Artist> - Topic" channel name as the artist. The raw values stay in `entry_sources` and the entry stays `unmatched` until M7 matching. The agent may pass clean title and artist directly.
3. Duplicate check by `(user_id, source type, external_id)`.
4. User marks a start (and optional end) from the player's current time — a `t=` in the pasted link pre-fills the start — and optionally writes a note. If the video can't be embedded (embedding disabled or age-restricted), the app shows a link that opens YouTube at the timestamp, and timestamps are typed in.
5. `core.addEntry` / `core.addHighlight` writes to Postgres; status becomes `needs_why` (no note) or `needs_tags` (note).
6. `lib/search` upserts the highlight's text to the vector index (see "Search sync").

### Save from the agent
1. Agent calls `add_entry` with a YouTube URL (required in v1, so every entry is verified and duplicate-checked), optional clean title/artist, highlight times and note.
2. Same core functions as above.
3. Agent calls `get_taxonomy`, then `set_highlight_tags` → status `tagged`, new tags created as `proposed`.

### Search
- **Exact/filter search:** SQL on title, artist, album, tags, axis, status.
- **Meaning search:** query text → Upstash Vector (embedded by the hosted model) → top highlight IDs filtered by `user_id` metadata → hydrate from Postgres.

### Search sync
Postgres is the source of truth; the vector index is a derived copy.
- Any change that alters a highlight's vector text sets `search_dirty = true` on **every affected highlight**, in the same transaction: a note edit, tag changes on the highlight, an entry title/artist change (all its highlights), and a tag rename, merge or rejection (every highlight carrying it).
- After the transaction, `lib/core` calls `lib/search.upsertHighlight` for the dirty rows and clears the flag on success. If the upsert fails, the flag stays set.
- Soft-deleting a highlight or entry deletes its vectors immediately.
- A re-sync job (`core.resyncSearch`) upserts every dirty row and removes vectors whose highlight no longer exists. It runs from a daily Vercel cron (Hobby cron jobs run at most once a day) and from a manual "Re-sync search" button.
- The vector text is `"{title} — {artists}. {note}. Tags: {tag names}"`; metadata holds `user_id`, `entry_id`, `status`, `captured_at`.
- The index can always be rebuilt from Postgres.

### Metadata matching (M7)
- `match_entry` (agent) or a server-side MusicBrainz lookup proposes a recording.
- High confidence: `mbid` is set, `match_status = matched`, artist records are created or linked from MusicBrainz, title/album/year are replaced with MusicBrainz values (raw values remain in `entry_sources`), and artist genres are fetched.
- Low confidence: the candidate goes in `mbid_candidate`, nothing else changes, and the entry shows "confirm match?" in the app. Confirming applies the high-confidence path with `match_status = confirmed`.

## Authentication

- **Web app (v1):** single owner. Password from an env var, signed session cookie, failed-attempt lockout — reuse the macro-log pattern, with state stored in Postgres (see [data model](data-model.md#auth-and-settings-tables)).
- **Middleware:** everything requires a session except `/login`, `/api/auth/*`, `/api/health`, and the paths that do their own auth: `/.well-known/*`, `/oauth/authorize`, `/api/oauth/*`, `/api/mcp` (bearer token), `/api/cron/*` (must check `Authorization: Bearer ${CRON_SECRET}` and fail closed).
- **MCP (v1):** OAuth 2.1 authorization server inside the app — discovery under `/.well-known/*`, dynamic client registration, PIN consent page, short-lived access tokens and refresh tokens stored only as hashes. Reuse the macro-log pattern.
- **Later (multi-user):** replace the owner password with real accounts. Because every row already carries `user_id` and every query is scoped by it, this change is contained to the auth layer and the consent page. This is the largest planned change; see [roadmap](roadmap.md).

## Free-tier limits (checked November 2026)

| Service | Free limit that matters | Expected use |
|---|---|---|
| Vercel Hobby | Non-commercial personal use only; 200 projects | 1 project |
| Neon Free | 100 projects, 1 GB storage per project, 100 CU-hours/month per project | Text notes; far below 1 GB |
| Upstash Vector Free | 10K queries + updates per day; max 1536 dimensions. Hosted embedding model: `openai/text-embedding-3-small` (1536 dimensions) — confirm free-plan availability and any embedding cost before M6 | Tens per day |
| MusicBrainz | Rate-limited (about 1 request/second per client); requires a descriptive User-Agent | Occasional lookups |
| YouTube oEmbed | No key; public and unlisted videos (not private ones) | One call per new entry |

If a limit becomes a problem, the fix is to upgrade that one service; nothing in the design depends on staying free forever.

## Environments

| Environment | Where | Database |
|---|---|---|
| Local dev | `npm run dev` | A Neon development branch |
| Unit tests / CI | `npm test` (locally and in GitHub Actions) | PGlite, in memory, migrated from empty on every run |
| Preview | Vercel preview deployment per PR | A Neon branch per preview via the Vercel–Neon integration, **with automatic branch deletion when the preview is removed**; Neon Free allows 10 branches per project. If that isn't reliable, fall back to one shared preview branch |
| Production | Vercel production (`main`) | Neon main branch |

Neon branches let each pull request test schema migrations against a copy of the data without touching production.

**Who runs migrations:** the `vercel-build` script runs `drizzle-kit migrate` against that environment's `DATABASE_URL`, then `next build`. A failed migration fails the deploy, so production is never left on code that expects a schema it doesn't have. Migrations are therefore written to be safe to run while the previous version is still serving (expand, then contract).

## Repository layout (target)

```
app/                 Next.js pages and API routes (thin)
  api/mcp/           MCP endpoint
  api/oauth/         OAuth authorization server
lib/
  core/              domain logic (tested)
  db/                Drizzle schema, queries, migrations
  search/            vector index adapter
  sources/           youtube.ts (later spotify.ts, film.ts, book.ts)
  metadata/          musicbrainz.ts
  mcp/               tool definitions, server instructions
  flags.ts           feature flags (reads FEATURE_* env vars)
taxonomy/            axes.json (taxonomy structure, versioned)
docs/                these documents
.github/             CI workflow, PR template
```
