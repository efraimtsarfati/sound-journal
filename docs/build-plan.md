# Build plan: who builds what, and how to spend tokens wisely

This turns the [roadmap](roadmap.md) milestones into sessions and tasks for Claude Code, with the model and agent best suited to each. The aim: the right model on the right job, small sessions, and as little re-reading as possible.

## Models at a glance

| Model | Use for | Cost |
|---|---|---|
| **Opus** | Planning milestones with real design risk, security-sensitive code (OAuth), reviewing schema and auth PRs | Highest — use for thinking, not typing |
| **Sonnet** | Almost all implementation: schema, core logic, UI, MCP tools, adapters, tests | Middle — the default |
| **Haiku** | Mechanical work: doc updates after a PR, renames, fixtures, small config edits | Lowest |

Switch in Claude Code with `/model`. A Mythos-tier model isn't needed anywhere in this project.

## Project agents (`.claude/agents/`)

Subagents start with a clean context, so they're worth it only for **well-bounded** tasks with a clear brief. Each is pinned to the cheapest model that does the job well.

| Agent | Model | Does | Doesn't |
|---|---|---|---|
| `db-schema` | Sonnet | Drizzle schema, migrations, `lib/db` queries, PGlite test setup | Business rules, UI |
| `core-logic` | Sonnet | `lib/core` functions and their Vitest tests (status transitions, tag lifecycle, duplicates, scoping) | Database schema design, UI |
| `ui-builder` | Sonnet | Pages and components, mobile-first, calling existing `lib/core`/API routes | New business rules, schema |
| `mcp-tools` | Sonnet | MCP tool wrappers and server instructions per `docs/mcp-server.md` | OAuth server internals, core rules |
| `pr-reviewer` | Opus | Read-only review of a branch against the docs and CLAUDE.md; runs tests | Editing code |
| `docs-sync` | Haiku | Updates docs to match what a PR actually changed | Changing code |

Built-in **Explore** is the right tool for "where is X handled?" searches. It's cheaper than reading files in the main session.

## Session rules (token hygiene)

1. **One milestone slice per session.** Start fresh, finish with a PR, then `/clear`. Long sessions re-send their whole history on every turn, so a cleared session is cheaper than a compacted one.
2. **Plan first, in plan mode** (Shift+Tab), and approve the plan before any code is written. Correcting a plan costs a little; correcting code costs a lot.
3. **Point at specific docs.** CLAUDE.md says to read the README and then the doc for the area — don't ask a session to "read everything."
4. **Run checks locally before pushing.** Each failed CI round trip is a fresh turn of reading logs.
5. **Delegate only bounded work to subagents**, with the exact files and doc sections in the brief. Small edits stay in the main session.
6. **End with `/wrap-up`, before `/clear`.** It ticks the status column, writes a short dev-log entry (where it stopped, gotchas, doc drift) and promotes recurring gotchas to CLAUDE.md. The next session reads one table and one entry instead of the git history.

## Kickoff prompt (copy, then edit the slice)

```
Read CLAUDE.md, README.md, docs/build-plan.md and the top entry of docs/dev-log.md.
Work on slice <M2a> from docs/build-plan.md.
Read only the docs that slice lists.
Start in plan mode: give me the plan, the files you'll create or change,
and the tests you'll add. Wait for my approval.
Then implement on a new branch, run typecheck/lint/tests/build,
open a PR using the template, then run /wrap-up. Stop after that.
```

For review, in a fresh session: `Use the pr-reviewer agent to review PR #<n> against the docs.`

## Slices

Status: ☐ not started · ◐ in progress · ☑ merged. The last slice of each milestone also cuts its release (M1 → `v0.1.0` … M8 → `v0.8.0`; `v1.0.0` when all acceptance criteria pass) — see CONTRIBUTING → Versioning and releases.

| Slice | Task | Main model | Agents | Read these docs | Human steps | Status |
|---|---|---|---|---|---|---|
| **M0** | Documentation | — | — | — | Review and merge PR #1, turn on branch protection | ◐ |
| **M1** | Next.js + TS + Tailwind skeleton, `/api/health` returning the `package.json` version, CI (typecheck, lint, test, build), `vercel-build` script; release `v0.1.0` | Sonnet | — | architecture (Stack, Repository layout), CONTRIBUTING | Create the Vercel project from the repo | ☐ |
| **M2a** | Drizzle schema for all tables, first migration with owner seed, PGlite test harness | Sonnet (plan with **Opus**) | `db-schema` | data-model (all), architecture (Environments) | Add Neon via Vercel Marketplace; `DATABASE_URL` appears in Vercel | ☐ |
| **M2b** | `lib/core`: entries, highlights, status transitions, tag lifecycle, soft delete, duplicate check + tests | Sonnet | `core-logic` | data-model (Statuses, rules), taxonomy (Rules) | — | ☐ |
| **M2 review** | Review the M2 PRs | — | `pr-reviewer` (Opus) | — | Read the review, merge | ☐ |
| **M3** | Owner login: password, session cookie, lockout (port from macro-log, state in Postgres), middleware exemptions | Sonnet | — | architecture (Authentication), data-model (Auth tables) | Set `APP_PASSWORD`, `SESSION_SECRET` in Vercel | ☐ |
| **M4a** | YouTube adapter: URL parsing incl. `t=`, oEmbed, title/artist derivation + tests with recorded responses | Sonnet | `core-logic` | architecture (Save from the web app) | — | ☐ |
| **M4b** | Capture screen: player, mark start/end, optional note, duplicate handling, embed fallback | Sonnet | `ui-builder` | spec-v1 (Capture), architecture | Test on your phone | ☐ |
| **M4c** | Entry list and detail, inbox counts, tag review list (against test data), soft delete/restore, JSON export | Sonnet | `ui-builder` | spec-v1 (Inbox, Browse), data-model (Export) | Test on your phone | ☐ |
| **M5a** | OAuth 2.1 server: discovery, DCR, PIN consent, tokens (port from macro-log, Postgres tables), cleanup cron | **Opus** plans, Sonnet implements | — | architecture (Authentication), data-model (Auth tables), mcp-server (top) | Set `CRON_SECRET` | ☐ |
| **M5b** | MCP endpoint, connector switches, read tools | Sonnet | `mcp-tools` | mcp-server (Tools: Read) | — | ☐ |
| **M5c** | Change and delete tools, server instructions | Sonnet | `mcp-tools` | mcp-server (all) | Connect Claude to `/api/mcp`, try voice capture and tagging | ☐ |
| **M5 review** | Security-focused review of M5 | — | `pr-reviewer` (Opus) | — | Read the review, merge | ☐ |
| **M6a** | Filters and text search | Sonnet | `core-logic` | spec-v1 (Browse and search) | — | ☐ |
| **M6b** | Upstash Vector adapter, dirty-flag sync, re-sync cron, meaning search in app and `search_highlights` | Sonnet | `core-logic` | architecture (Search sync), ADR 0003 | Create the Upstash Vector index (hosted embedding model); confirm free-plan embedding first | ☐ |
| **M7** | MusicBrainz adapter, `match_entry`, artist dedupe, genre layer, confirm-match UI | Sonnet | `core-logic`, `ui-builder` | architecture (Metadata matching), data-model (artists, artist_genres) | Set `MUSICBRAINZ_CONTACT` | ☐ |
| **M8** | PWA install, mobile pass, capture speed check | Sonnet | `ui-builder` | spec-v1 (Acceptance criteria, Non-functional) | Run all 8 acceptance checks on your phone | ☐ |
| **Each PR** | Bring docs in line with what shipped | Haiku | `docs-sync` | the PR diff | — | — |

### Why the expensive model goes where it does

- **M2a planning:** the schema is the hardest thing to change later. One Opus planning pass is cheap insurance.
- **M5a:** OAuth mistakes are security holes. Opus plans it; Sonnet types it; Opus reviews it.
- **Reviews of M2 and M5:** a fresh Opus reviewer that didn't write the code catches what the author missed.
- **Everything else** is well specified by the docs, which is exactly what makes Sonnet (and Haiku for docs) enough.
