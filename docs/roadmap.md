# Roadmap

Two parts: **v1 milestones** (each roughly one pull request, each leaving the app working) and **future features** (each with the extension point it uses and what it costs).

## V1 milestones

| # | Milestone | Delivers | Done when |
|---|---|---|---|
| M0 | Documentation | This doc set, taxonomy structure, PR template, CI workflow stub | Docs reviewed and merged |
| M1 | Skeleton | Next.js + TypeScript + Tailwind app, lint/typecheck/test/build in CI, deployed to Vercel, `/api/health` | A blank app is live; a PR shows a preview URL and green checks |
| M2 | Data layer | Neon connected, Drizzle schema for all [data-model](data-model.md) tables, first migration, `lib/db`, `lib/core` functions for entries/highlights/tags/statuses, unit tests | Migrations run from an empty database; core tests pass |
| M3 | Owner login | Password gate + signed session cookie + lockout (macro-log pattern) | Production requires login; previews are protected |
| M4 | Capture & browse | YouTube link → oEmbed → embedded player; mark start/end while playing; optional note; entry list and detail; duplicate check; inbox counts; tag review list (approve/rename/merge/reject, built against test data); soft delete and restore; JSON export | Acceptance criteria 1, 2, 8 in [spec-v1](spec-v1.md) |
| M5 | MCP server | OAuth 2.1 + DCR + PIN consent, connector switches, v1 tools from [mcp-server.md](mcp-server.md), server instructions, daily cleanup cron for expired auth rows | Owner connects Claude; criteria 3, 4 and 7 pass with real agent-proposed tags |
| M6 | Search | Filters (tag, axis, artist, status), text search, Upstash Vector sync with re-sync job, meaning search in app and `search_highlights` | Criteria 5 and 6 pass |
| M7 | Metadata | MusicBrainz lookup adapter, `match_entry`, artist records, genre layer, confirm-match UI | New entries get matched or flagged `unmatched` |
| M8 | Phone polish | PWA install, mobile layout pass, capture speed check | All acceptance criteria pass on a phone |

Each milestone ships as a release: M1 → `v0.1.0` through M8 → `v0.8.0`, and `v1.0.0` once every acceptance criterion passes on a phone.

Order matters: M2 (data) before M4 (screens) and M5 (agent), because both interfaces are thin layers over the same core. [build-plan.md](build-plan.md) splits these milestones into Claude Code sessions, with the model and agent for each.

## Future features

Effort: **S** = a few PRs, no schema redesign · **M** = new tables or a new subsystem · **L** = crosses most layers.

| Feature | What it is | Uses extension point | Effort | Notes |
|---|---|---|---|---|
| **How to play / gear** | "How do I play this part?" "What gear made this sound?" | MCP read tools + `mbid` (credits, members) | **S** (agent-side) | Mostly server-instruction guidance; maybe a `get_credits` tool that fetches MusicBrainz relationships |
| **Taste map** | Tags as nodes sized by use, edges for co-occurrence on a highlight, timeline by month, balance by axis | `captured_at`, `added_at`, `tags.axis` | **S** | Pure read-side page + `get_taste_summary` tool. Meaningful after ~50–100 highlights |
| **Discovery loop** | Agent suggests tracks sharing the qualities of chosen highlights; suggestions land in the journal as `to_listen`; the user's reaction feeds the next round | `entries.origin = 'suggested'` | **M** | New status for suggested entries (`to_listen` → `kept`/`passed`), `add_suggestion` + `record_listen_feedback` tools. Agent must verify every suggestion exists. Playlists are made through the user's own Spotify connector in their agent, not the app |
| **Spotify capture** | "Save what's playing" with current position | `entry_sources.type = 'spotify'` | **S–M** | Spotify Web API Development Mode needs the developer to have Premium and allows up to 5 authorized users — fine for personal use, a blocker for public use without Extended Quota approval. Keep YouTube as the universal source |
| **Films** | Scenes as highlights | `entries.kind = 'film'`, new source adapter | **S–M** | Film clips on YouTube are patchy; allow highlights with a time reference and no playable clip |
| **Books** | Passages as highlights | `entries.kind = 'book'`, `start`/`end` become page/location references | **M** | Store short quotes plus page references only; needs a highlight "locator" generalization (time *or* page) — the one schema change to plan carefully |
| **Last.fm signal** | Crowd tags and similar tracks as a second discovery signal | `artist_genres.source = 'lastfm'` for crowd tags; similar-track lookups called live by the agent or a `get_similar` tool (not stored) | **S** | Free API key (not AI). Genre-level, not moment-level |
| **Manual tagging** | Owner adds tags by hand in the app | `created_by` / `added_by = 'user'` | **S** | UI only; rules unchanged |
| **Public boards** | Curated, shareable collections with an explanation per item (e.g. an author's "what inspired this book") | `visibility`, `user_id` | **M–L** | New `boards` and `board_items` tables, public pages, real accounts (see multi-user) |
| **Multiple users** | Sign-up and accounts | `user_id` everywhere | **L** | Replace owner password with an auth provider; per-user OAuth consent. Largest planned change, contained to the auth layer |
| **Community search & word clouds** | Search everyone's public notes by meaning; "people describe this as: weaving, touching, sparse" | `visibility`, vector metadata | **L** | Privacy rules, moderation, abuse limits; vector index namespaces per visibility |

### Why discovery lives in the agent

Spotify removed recommendations, related artists and audio features for new apps in November 2024, and YouTube search is keyword-only. The user's highlights describe *techniques and moments*, which a language model reasons about well ("interlocking guitars" → Television, Talking Heads' *Remain in Light* era, King Crimson's *Discipline*, Midwest emo). So: the app supplies the user's own words; the agent reasons, verifies tracks exist, and builds playlists with the user's own Spotify connector.

## How to add a feature (process)

1. **Brief.** Copy [`docs/features/_template.md`](features/_template.md) to `docs/features/<feature>.md`: problem, scope, out of scope, data changes, which extension point it uses, acceptance criteria.
2. **Decision record** if it makes a significant or hard-to-reverse choice (new service, schema redesign): `docs/decisions/NNNN-title.md`.
3. **Branch** from `main`: `feat/<feature>`.
4. **Schema changes go through a migration**, never by hand. Additive changes (new nullable column, new table) first; destructive ones only after data has been moved and a release has passed.
5. **Feature flag** for anything that ships before it's finished: an env var `FEATURE_<NAME>=on` read in one place (`lib/flags.ts`). Merged-but-off code is fine; long-lived branches are not.
6. **Pull request** with the template filled in; test on the Vercel preview, on a phone when it's UI.
7. **Docs in the same PR.** A PR that changes behavior updates the relevant doc. Docs that disagree with the code are bugs.

### What branches do and don't do

Branches let you build and test a feature in isolation, and throw it away without touching `main`. They don't stop a feature from needing a rewrite — the layering rules and reserved fields do. If a feature needs changes in more than one layer *and* a schema redesign, stop and write a decision record before coding.
