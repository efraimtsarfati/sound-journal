# Build plan: who builds what, and how to spend tokens wisely

This turns the [roadmap](roadmap.md) milestones into sessions and tasks for Claude Code, with the model and agent best suited to each. The aim: the right model on the right job, small sessions, and as little re-reading as possible.

## Models at a glance

| Model | Use for | Cost |
|---|---|---|
| **Opus** | Planning milestones with real design risk, security-sensitive code (OAuth), reviewing schema and auth PRs | Highest — use for thinking, not typing |
| **Sonnet** | Almost all implementation: schema, core logic, UI, MCP tools, adapters, tests | Middle — the default |
| **Haiku** | Mechanical work: doc updates after a PR, renames, fixtures, small config edits | Lowest |
| **`opusplan`** | A built-in Claude Code mode: Opus while in plan mode, then it switches to Sonnet automatically when you approve the plan and it starts implementing | Opus only for the thinking |

A Mythos-tier model isn't needed anywhere in this project.

## Getting the right model without thinking about it

A session can't change its own model, so the setup does it for you at the points where it can:

| Mechanism | What it does |
|---|---|
| Project default (`.claude/settings.json`) | Every session in this repo starts on `sonnet` unless you choose otherwise, so forgetting costs nothing extra |
| Start with the slice's model | `claude --model opusplan` from a terminal, or `/model opusplan` as the first thing in a session. Use the **Model** column below |
| `opusplan` | For the two risky slices (M2a, M5a): Opus plans, then it switches itself to Sonnet when you approve the plan |
| Pinned agents | Each agent in `.claude/agents/` always runs on its own model (the reviewer on Opus, `docs-sync` on Haiku), whatever the session is on |
| `/wrap-up` | Runs on Haiku for that turn, then hands back to your session's model |
| Model check | CLAUDE.md tells every session to compare the model it's running on with the slice's **Model** column before planning. If they differ, it stops and tells you the exact `/model` command — you switch (or tell it to carry on), and it continues |


## Effort levels

Effort is how much the model thinks before answering. More effort means more thinking tokens: better on hard reasoning, wasted on boilerplate. Opus, Sonnet and Haiku 5.5 support `low`, `medium`, `high`, `xhigh` and `max`, and default to `medium`. The project sets `medium` explicitly in `.claude/settings.json`, so it stays put if defaults change.

| Level | Use for here |
|---|---|
| `low` | Scaffolding, wiring, simple UI passes, review sessions where the agent does the real work |
| `medium` | Most implementation — the default |
| `high` | The two slices where a wrong design is expensive (M2a schema, M5a OAuth) and the reviewer agent |
| `xhigh`, `max` | Not needed in this project. Reach for them only when a `high` session is visibly going in circles on a hard bug |

**How it's applied:**
- **At launch:** `claude --model <model> --effort <level>`, from the **Model** and **Effort** columns below. For example, M2a: `claude --model opusplan --effort high`.
- **Mid-session:** `/effort high`, or the left/right arrows on the slider in `/model`. Typing a level after `/effort` saves it as your default, so use `/effort auto` afterwards (or `s` in the slider for this session only) to avoid carrying `high` into the next slice.
- **Agents and skills pin their own effort:** `pr-reviewer` runs at `high`; `docs-sync` and `/wrap-up` at `low`; the building agents at `medium`. These override the session level while they're active.
- **The model check doesn't cover effort:** a session can't reliably see its own effort level, so the launch command is what sets it.

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

## Autopilot (no manual PR approvals)

To build several slices in one go, start an orchestrator session and let it run:

```
claude --model sonnet --effort low
/autopilot until M4c
```

It picks the next ☐ slice, runs it in a fresh subagent on that slice's model and effort (`opusplan` slices get an Opus planning subagent, then a Sonnet implementer), has the Opus `pr-reviewer` check slices that touch schema, auth, deletion or search sync, and enables auto-merge so GitHub merges each PR when its checks pass. It publishes releases when a milestone completes.

It **stops and asks** only for: human steps in the table below (accounts, secrets), a check that fails twice, a blocking review finding that survives one fix round, or a doc ambiguity that changes behavior. The "review" rows in the table are handled inside autopilot's review gate.

**Permission prompts** are the owner's call, so the repo doesn't pre-approve anything. For an unattended run, either start Claude Code in auto mode, or add an allowlist to your own `.claude/settings.local.json` (git-ignored), for example allowing `Bash(git *)`, `Bash(gh *)`, `Bash(npm *)`, `Bash(npx *)` and `Bash(node *)` while denying `Bash(git push --force*)`, `Bash(gh repo delete*)` and `Read(./.env*)`.

## Kickoff prompt (one slice, interactive)

Launch with the slice's model and effort first, e.g. `claude --model sonnet --effort medium`. Then paste:

```
Read CLAUDE.md, README.md, docs/build-plan.md and the top entry of docs/dev-log.md.
Work on slice <M2a> from docs/build-plan.md.
First check that you're running on that slice's Model; if not, stop and tell me the /model command.
Read only the docs that slice lists.
Start in plan mode: give me the plan, the files you'll create or change,
and the tests you'll add. Wait for my approval.
Then implement on a new branch, run typecheck/lint/tests/build,
open a PR using the template, then run /wrap-up. Stop after that.
```

For review, in a fresh session: `Use the pr-reviewer agent to review PR #<n> against the docs.`

## Slices

Status: ☐ not started · ◐ in progress · ☑ merged. The last slice of each milestone also cuts its release (M1 → `v0.1.0` … M8 → `v0.8.0`; `v1.0.0` when all acceptance criteria pass) — see CONTRIBUTING → Versioning and releases.

| Slice | Task | Model | Effort | Agents | Read these docs | Human steps | Status |
|---|---|---|---|---|---|---|---|
| **M0** | Documentation | — | — | — | — | Review and merge PR #1, turn on branch protection | ☑ |
| **M1** | Next.js + TS + Tailwind skeleton, `/api/health` returning the `package.json` version, CI (typecheck, lint, test, build), `vercel-build` script; release `v0.1.0` | `sonnet` | low | — | architecture (Stack, Repository layout), CONTRIBUTING | Create the Vercel project from the repo | ☑ |
| **M2a** | Drizzle schema for all tables, first migration with owner seed, PGlite test harness | `opusplan` | high | `db-schema` | data-model (all), architecture (Environments) | Add Neon via Vercel Marketplace; `DATABASE_URL` appears in Vercel. Only production builds run migrations; previews never migrate and share the production DB until Neon branch-per-preview is enabled | ☑ |
| **M2b** | `lib/core`: entries, highlights, status transitions, tag lifecycle, soft delete, duplicate check + tests | `sonnet` | medium | `core-logic` | data-model (Statuses, rules), taxonomy (Rules) | — | ☑ #7 |
| **M2 review** | Review the M2 PRs | `haiku` (the reviewer agent runs on Opus) | low | `pr-reviewer` (Opus) | — | Read the review, merge | ☑ done inside the M2a/M2b review gates |
| **M2c** | Core hardening (M2b review follow-ups): wrap the duplicate check and the insert in one transaction guarded by a per-source advisory lock (`pg_advisory_xact_lock` on user + source type + external ID); lock the tag rows involved (`SELECT … FOR UPDATE`) in `set_highlight_tags`, reject and merge so they can't interleave; move every remaining check-then-write in `lib/core` into a transaction; tests for each (PGlite runs one connection, so assert the locked/transactional path and the sequential outcomes) | `sonnet` | medium | `core-logic` | data-model (rules, Statuses), architecture (Key flows) | — | ☑ #9 |
| **M3** | Owner login: password, session cookie, lockout (port from macro-log, state in Postgres), middleware exemptions | `sonnet` | medium | — | architecture (Authentication), data-model (Auth tables) | Set `APP_PASSWORD`, `SESSION_SECRET` in Vercel | ☑ #10 |
| **M4a** | YouTube adapter: URL parsing incl. `t=`, oEmbed, title/artist derivation + tests with recorded responses | `sonnet` | medium | `core-logic` | architecture (Save from the web app) | — | ☑ #11 |
| **M4b** | Capture screen: player, mark start/end, optional note, duplicate handling, embed fallback | `sonnet` | medium | `ui-builder` | spec-v1 (Capture), architecture | Test on your phone | ☑ #12 |
| **M4c** | Entry list and detail, inbox counts, tag review list (against test data), soft delete/restore (restore takes the same per-source lock as M2c and refuses when a live entry already has that source — it offers to move the restored highlights onto the live entry instead), JSON export | `sonnet` | medium | `ui-builder` | spec-v1 (Inbox, Browse), data-model (Export) | Test on your phone | ☑ #13 |
| **M5a** | OAuth 2.1 server: discovery, DCR, password consent, tokens (port from macro-log, Postgres tables), daily cleanup cron (expired auth rows **and** the 30-day purge of soft-deleted entries and highlights) | `opusplan` | high | — | architecture (Authentication), data-model (Auth tables), mcp-server (top) | Set `CRON_SECRET` (16+ random chars) and `APP_ORIGIN` (`https://sound-journal.vercel.app`) in Vercel | ☑ #14 |
| **M5b** | MCP endpoint, connector switches, read tools | `sonnet` | medium | `mcp-tools` | mcp-server (Tools: Read) | — | ☑ #15 |
| **M5c** | Change and delete tools, server instructions | `sonnet` | medium | `mcp-tools` | mcp-server (all) | Connect Claude to `/api/mcp`, try voice capture and tagging | ☑ #16 |
| **M5d** | Security and settings fixes (owner decisions 2026-11-21): (1) **consent errors** never redirect unless the client *and* its exact registered redirect URI are validated; otherwise show an error page with no link back ("You can close this tab."); (2) **login and consent lockout per client IP** (Vercel `x-forwarded-for`), 5 fails → 15 min, plus a global backstop of 50 fails/hour that only slows (adds delay), never locks the owner out; (3) **rate-limit `/api/oauth/register`** per IP (10/hour) on top of the client cap; (4) **delete tools need `enabled && allowChanges && allowDeletes`**; `restore_deleted` needs `allowChanges`; (5) **Settings page section for the three connector switches** (Connector: on/off, Allow changes, Allow deletes), plus connected apps with Revoke; (6) server instructions mention `match_entry` only when that tool is registered (M7). Update mcp-server, architecture (Authentication) and data-model (auth tables) docs | `sonnet` | medium | `ui-builder`, `core-logic` | mcp-server (all), architecture (Authentication), data-model (Auth and settings tables) | — | ☑ #19 |
| **M5e** | M5c review follow-ups 3–11 from PR #16's description (artist name normalization, recording the agent name on tags, always verifying oEmbed in `add_entry`, time-zone edge cases, refusing status-like tag names such as `needs_why`, and the rest of that list) | `sonnet` | medium | `core-logic`, `mcp-tools` | mcp-server (Tools), data-model (rules), taxonomy (Rules) | — | ☑ #21 |
| **M5f** | M5 security-review fixes (owner-approved): connector switch rules in `lib/core` (`assertConnectorAllows`); `add_entry` calls oEmbed before the transaction with a 5 s abort and refuses unverifiable results (timeout, network, 5xx), keeping the agent title only for a definite 401/403; one implementation of list/revoke connected apps; Origin and content-type check on the session routes; authorization-code reuse revokes the grant (expand-only migration `0001`); docs nit and accepted risks | `sonnet` | medium | `core-logic`, `mcp-tools` | mcp-server (Tools), architecture (Authentication), data-model (Auth and settings tables) | — | ☑ #23 |
| **M5 review** | Security-focused review of M5, **run after M5d and M5e** against the combined result | `haiku` (the reviewer agent runs on Opus) | low | `pr-reviewer` (Opus) | — | — (autopilot fixes blocking findings itself) | ☑ done, no blocking findings; fixes shipped in M5f #23 |
| **M6a** | Filters and text search | `sonnet` | low | `core-logic` | spec-v1 (Browse and search) | — | ☑ #24 |
| **M4d** | Song page and clip editing (owner decision 2026-11-21; this was missing from M4, so acceptance criterion 2 couldn't pass in the app): (1) after **Save**, capture always goes to the song's page; (2) the **song page** has one player at the top, and tapping a clip's time plays it from its start; (3) each **clip card** shows its time range, its why (read-only, or "No why yet" for `needs_why`) and its tags, with an **Edit** button; Edit opens the why textarea and start/end with "Mark" from the player, plus Save, Cancel and Delete; (4) **Add a clip** on the song page opens a new card in edit mode (no trip back to capture); (5) the inbox's `needs_why` items link to that clip's card, already in edit mode. Add HTTP routes for editing and adding a highlight that wrap the existing `lib/core` `updateHighlight` (status transitions as in data-model, highlight workflow) and the add-highlight core function, following the injected-`db` `lib/http` pattern | `sonnet` | medium | `ui-builder` | spec-v1 (Capture, Browse and search), data-model (Highlight workflow) | Test on your phone: add a why to an existing clip, edit it, add a second clip | ☑ #25 |
| **M6b** | Upstash Vector adapter, dirty-flag sync, re-sync cron, meaning search in app and `search_highlights` (replacing the interim substring match, an accepted owner decision); delete vectors for the highlight IDs returned by the 30-day purge | `sonnet` | medium | `core-logic` | architecture (Search sync), ADR 0003 | — (done 2026-11-21: Free-plan index with `openai/text-embedding-3-small`, `UPSTASH_VECTOR_REST_URL` and `UPSTASH_VECTOR_REST_TOKEN` set in Vercel for Production and Preview) | ☑ #27 |
| **M7** | MusicBrainz adapter, `match_entry`, artist dedupe, genre layer, confirm-match UI | `sonnet` | medium | `core-logic`, `ui-builder` | architecture (Metadata matching), data-model (artists, artist_genres) | — (done: `MUSICBRAINZ_CONTACT` set in Vercel) | ◐ #28 |
| **M8** | PWA install, mobile pass, capture speed check | `sonnet` | low | `ui-builder` | spec-v1 (Acceptance criteria, Non-functional) | Run all 8 acceptance checks on your phone | ☐ |
| **Each PR** | Bring docs in line with what shipped | any (the agent runs on Haiku) | — | `docs-sync` | the PR diff | — | — |

### Why the expensive model goes where it does

- **M2a planning:** the schema is the hardest thing to change later. One Opus planning pass is cheap insurance.
- **M5a:** OAuth mistakes are security holes. Opus plans it; Sonnet types it; Opus reviews it.
- **Reviews of M2 and M5:** a fresh Opus reviewer that didn't write the code catches what the author missed.
- **Everything else** is well specified by the docs, which is exactly what makes Sonnet (and Haiku for docs) enough.

### Follow-ups without a slice

- **M3 review follow-ups** (locked, row-locked `attemptLogin`; array `next`/`error` params; non-form login body) were addressed in M5a. The 30-day purge is built (M5a cleanup cron); vector deletion for purged highlights was added in M6b.
