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
| **M1** | Next.js + TS + Tailwind skeleton, `/api/health` returning the `package.json` version, CI (typecheck, lint, test, build), `vercel-build` script; release `v0.1.0` | `sonnet` | low | — | architecture (Stack, Repository layout), CONTRIBUTING | Create the Vercel project from the repo | ◐ #4 |
| **M2a** | Drizzle schema for all tables, first migration with owner seed, PGlite test harness | `opusplan` | high | `db-schema` | data-model (all), architecture (Environments) | Add Neon via Vercel Marketplace; `DATABASE_URL` appears in Vercel | ☐ |
| **M2b** | `lib/core`: entries, highlights, status transitions, tag lifecycle, soft delete, duplicate check + tests | `sonnet` | medium | `core-logic` | data-model (Statuses, rules), taxonomy (Rules) | — | ☐ |
| **M2 review** | Review the M2 PRs | `haiku` (the reviewer agent runs on Opus) | low | `pr-reviewer` (Opus) | — | Read the review, merge | ☐ |
| **M3** | Owner login: password, session cookie, lockout (port from macro-log, state in Postgres), middleware exemptions | `sonnet` | medium | — | architecture (Authentication), data-model (Auth tables) | Set `APP_PASSWORD`, `SESSION_SECRET` in Vercel | ☐ |
| **M4a** | YouTube adapter: URL parsing incl. `t=`, oEmbed, title/artist derivation + tests with recorded responses | `sonnet` | medium | `core-logic` | architecture (Save from the web app) | — | ☐ |
| **M4b** | Capture screen: player, mark start/end, optional note, duplicate handling, embed fallback | `sonnet` | medium | `ui-builder` | spec-v1 (Capture), architecture | Test on your phone | ☐ |
| **M4c** | Entry list and detail, inbox counts, tag review list (against test data), soft delete/restore, JSON export | `sonnet` | medium | `ui-builder` | spec-v1 (Inbox, Browse), data-model (Export) | Test on your phone | ☐ |
| **M5a** | OAuth 2.1 server: discovery, DCR, PIN consent, tokens (port from macro-log, Postgres tables), cleanup cron | `opusplan` | high | — | architecture (Authentication), data-model (Auth tables), mcp-server (top) | Set `CRON_SECRET` | ☐ |
| **M5b** | MCP endpoint, connector switches, read tools | `sonnet` | medium | `mcp-tools` | mcp-server (Tools: Read) | — | ☐ |
| **M5c** | Change and delete tools, server instructions | `sonnet` | medium | `mcp-tools` | mcp-server (all) | Connect Claude to `/api/mcp`, try voice capture and tagging | ☐ |
| **M5 review** | Security-focused review of M5 | `haiku` (the reviewer agent runs on Opus) | low | `pr-reviewer` (Opus) | — | Read the review, merge | ☐ |
| **M6a** | Filters and text search | `sonnet` | low | `core-logic` | spec-v1 (Browse and search) | — | ☐ |
| **M6b** | Upstash Vector adapter, dirty-flag sync, re-sync cron, meaning search in app and `search_highlights` | `sonnet` | medium | `core-logic` | architecture (Search sync), ADR 0003 | Create the Upstash Vector index (hosted embedding model); confirm free-plan embedding first | ☐ |
| **M7** | MusicBrainz adapter, `match_entry`, artist dedupe, genre layer, confirm-match UI | `sonnet` | medium | `core-logic`, `ui-builder` | architecture (Metadata matching), data-model (artists, artist_genres) | Set `MUSICBRAINZ_CONTACT` | ☐ |
| **M8** | PWA install, mobile pass, capture speed check | `sonnet` | low | `ui-builder` | spec-v1 (Acceptance criteria, Non-functional) | Run all 8 acceptance checks on your phone | ☐ |
| **Each PR** | Bring docs in line with what shipped | any (the agent runs on Haiku) | — | `docs-sync` | the PR diff | — | — |

### Why the expensive model goes where it does

- **M2a planning:** the schema is the hardest thing to change later. One Opus planning pass is cheap insurance.
- **M5a:** OAuth mistakes are security holes. Opus plans it; Sonnet types it; Opus reviews it.
- **Reviews of M2 and M5:** a fresh Opus reviewer that didn't write the code catches what the author missed.
- **Everything else** is well specified by the docs, which is exactly what makes Sonnet (and Haiku for docs) enough.
