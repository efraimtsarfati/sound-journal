# Dev log

Newest entry first. Written by the `wrap-up` skill at the end of every build session. A new session reads only the top entry. Recurring gotchas are promoted to `CLAUDE.md` or the relevant doc; this file is the history, not the rulebook.

---
## 2026-11-21 — M5c — MCP change and delete tools, server instructions (PR #16)
**State:** done, no migration. Tools `add_entry`, `add_highlight`, `update_highlight`, `set_highlight_tags`, `restore_deleted` (need `allowChanges`), `delete_highlight`, `delete_entry` (need `allowDeletes`, `confirm: true`); server `instructions` on initialize. Core in `lib/core/agent-write.ts` and `dates.ts`. M5b review fixes: search dates in `settings.time_zone` (real calendar dates only), generic message plus `console.error` for non-CoreError failures, cursor bounded at 1,000,000, cross-user isolation tests for every tool, doc nits. 301 tests; typecheck, lint, test, build pass. Cuts v0.5.0.
**Next:** owner sets the switches by SQL if needed (docs/mcp-server.md) and connects Claude to `/api/mcp`; tag `v0.5.0` after merge; M5 review (`pr-reviewer`, Opus); the switches still have no web UI (owner decision pending).
**Gotchas:**
- Axes in `taxonomy/axes.json` are sound, technique, structure, feeling, lyric, association; test fixtures using other axis names (texture) fail `set_highlight_tags`.
- Bash heredocs and long node one-liners with quotes failed again -> write scripts with the Write tool, run them from the scratchpad.
**Doc drift:** mcp-server (switch SQL, tool details, date semantics, match_entry is M7), architecture, spec-v1, roadmap.
**Follow-ups:** `match_entry` waits for M7 although instruction 8 mentions it; `add_entry` is not one transaction across several highlights (inputs are validated first); not tried against a real MCP client.

## 2026-11-21 — M5b — MCP endpoint, connector switches, read tools (PR #15)
**State:** done, no migration. `POST /api/mcp` (`lib/http/mcp.ts`, `lib/mcp/server.ts`, `app/api/mcp/route.ts`): stateless streamable HTTP via `@modelcontextprotocol/sdk` 1.32, JSON responses, GET/DELETE 405, 401 + `WWW-Authenticate` resource_metadata, `verifyAccessToken`. Read tools: `list_inbox`, `get_taxonomy`, `search_highlights`, `get_entry`, `list_entries` (core in `lib/core/agent-read.ts`); each checks the enabled switch. Also fixed the M5a review items: `attemptLogin` resets the row on success and re-creates a vanished row; `registerClient` evicts the oldest unused clients at the cap. 23 new tests (284 total); typecheck, lint, test, build pass. No release (M5 not finished).
**Next:** M5c (`mcp-tools`): change and delete tools plus the server instructions (copy docs/mcp-server.md exactly); then M5 review. The `allowChanges`/`allowDeletes` checks already exist in `guarded()` in `lib/mcp/server.ts`.
**Gotchas:**
- Working copy files are CRLF (autocrlf) -> multi-line string-replace scripts in node/sed silently match nothing; use the Edit tool or normalize first.
- `mcp-handler` 2.x peers on unreleased SDK 2 packages -> used the SDK 1.x web-standard transport directly.
**Doc drift:** architecture (MCP dependency, endpoint, client cap), mcp-server (search query interim).
**Follow-ups:** `search_highlights.query` is a plain text match until M6 adds vector search (no score); not tried against a real MCP client or a deployed preview; the connector switches have no web UI yet (defaults apply: enabled, changes on, deletes off).

## 2026-11-21 — M5a — OAuth 2.1 server, password consent, daily cleanup cron (PR #14)
**State:** done, no migration. `lib/auth/` (crypto, cron secret, OAuth metadata), `lib/core/oauth*.ts` and `cleanup.ts`, `lib/http/` handlers (register, token, consent, discovery, cron), routes under `/api/oauth/*`, `/.well-known/*`, `/oauth/authorize` page, `/api/cron/cleanup` + `vercel.json` cron. Consent uses `APP_PASSWORD` through the now-transactional `attemptLogin` (owner-approved change from the PIN draft). The `/api/mcp/` prefix exemption is gone (exact `/api/mcp` only). 69 new tests (261 total); typecheck, lint, test, build pass. No release (M5 not finished).
**Next:** owner sets `CRON_SECRET` (16+ chars) and `APP_ORIGIN=https://sound-journal.vercel.app` in Vercel before merging; Opus review (`pr-reviewer`) of this PR per the build plan; then M5b (`mcp-tools`, serves exactly `/api/mcp`, 401 with `WWW-Authenticate` resource_metadata, uses `verifyAccessToken`).
**Gotchas:**
- Bash heredoc with quotes in a long multi-file command failed again and wrote nothing -> use the Write tool.
- No `python3` on this machine -> sed/Edit/Write only; a `#` inside a sed replacement breaks `s#..#..#`.
**Doc drift:** mcp-server (auth line), data-model (auth_attempts key, constraints 6 and 13, purge bullet), architecture (OAuth, cleanup cron, sessions, layout), build-plan (M4c done, M5a status, follow-ups).
**Follow-ups:** M6b must delete vectors for the highlight ids `purgeDeleted` returns; the consent page and token flow were tested on PGlite and in the build only, not against a real MCP client or the Vercel cron; "connected apps" management UI (`listGrants`/`revokeGrant` exist) is not built, use `/api/connections/*` when it is.


## 2026-11-21 — M4c — Entry list/detail, inbox counts, tag review, restore, export (PR #13)
**State:** done. `lib/core/browse.ts` (list/get entries, inbox counts, proposed/approved tags, export) and `lib/core/restore.ts` (`restoreEntry`, `moveDeletedHighlightsToLiveEntry`; both take `lockSource` for every source of the entry in a fixed order). Pages `/`, `/entries/[id]`, `/tags`, `/deleted`; routes under `/api/entries`, `/api/highlights`, `/api/tags/[id]`, `/api/export`. 18 new tests (192 total); typecheck, lint, test, build pass. Cuts v0.4.0 (milestone M4).
**Next:** owner tests on phone (capture, browse, delete/restore); tag `v0.4.0` after merge; then M5a (Opus planning).
**Gotchas:**
- Restore returns only highlights deleted at the same instant as the entry, so highlights deleted on their own earlier stay deleted.
- Bash heredoc with quotes failed again writing components, so use the Write tool.
**Doc drift:** none.
**Follow-ups:** "Add a highlight" links to `/capture?url=...`, which prefills the link but doesn't auto-run the lookup; no browser run was done (no DB or session locally), only build and core tests.

## 2026-11-21 — M4a — YouTube adapter (PR #11)
**State:** done. `lib/sources/youtube.ts`: `parseYouTubeUrl` (watch, youtu.be, music/m, embed, shorts, `t=`/`start=`/`#t=`, `1h2m3s` forms), `fetchOEmbed` (injectable fetch; 404 `not_found`, 401/403 `not_embeddable`, else `unavailable`), `deriveTitleArtist`, `youtubeWatchUrl`. 60 new tests (174 total); typecheck, lint, test, build pass. Not wired to anything yet.
**Next:** M4b (capture screen, `ui-builder`) calls these from a route/core wrapper; owner tests on phone after M4b.
**Gotchas:**
- A recorded real oEmbed response ("(Official Video) (4K Remaster)") exposed a noise pattern the hand-written cases missed -> added `4k`/`hd` before "remaster".
- Only "<Artist> - Topic" channels are used as the artist; any other channel name is left out rather than guessed.

## 2026-11-21 — M3 — Owner login (PR #10)
**State:** done. `proxy.ts` gates everything except the documented exemptions; `/login` page, `POST /api/auth/login` and `/api/auth/logout`; signed session cookie (`lib/auth/session.ts`); lockout in Postgres (`lib/core/auth.ts`, 5 fails -> 15 min). 10 new tests (114 total); typecheck, lint, test, build pass. Cuts v0.3.0 (milestone M3).
**Next:** owner sets `APP_PASSWORD` and `SESSION_SECRET` in Vercel (Production and Preview) before merging, or the site stays locked; tag `v0.3.0` after merge. Then M4a.
**Gotchas:**
- Next 16 renamed `middleware.ts` to `proxy.ts` (Node runtime), so `node:crypto` works there.
- Lockout thresholds weren't in the docs (macro-log not available); chose 5 fails / 15 min and recorded them in architecture.

## 2026-11-21 — M2c — lib/core hardening: advisory lock and row locks (PR #9)
**State:** done. `addEntry` checks and inserts under a per-source advisory lock (`lockSource`, exported for M4c restore); tag rows are locked `FOR UPDATE` in set/approve/reject/rename/merge (fixed order, `ON CONFLICT DO NOTHING` on tag create); `addHighlight`, `setHighlightNote`, `approveTag` are now transactional. 8 new tests (104 total); typecheck, lint, test, build pass. Not user-visible, no changelog line.
**Next:** merge PR #9, then M3 (asks for `APP_PASSWORD` and `SESSION_SECRET`).
**Gotchas:**
- Sorting inputs to lock tags in a fixed order changed the `created` order → restore input order after resolving.
- PGlite is one connection, so tests assert the lock exists in `pg_locks` and the sequential outcomes, not true interleaving.

## 2026-11-20 — chore — Open items after M2 (PR #8)
**State:** done. Checked production: the M2a deploy's build log shows `drizzle-kit migrate` → "migrations applied successfully", and the M2b deploy is live; the production DB is on the single `0000_init` migration. M2b's deferred review items became slice **M2c** (core hardening). Restore-duplicate rule added to M4c and the data model. The 30-day purge now runs in M5a's daily cleanup cron. Neon branch-per-preview is off by decision (architecture → Environments); turning it on is a roadmap item. M2b and the M2 review row ticked.
**Next:** `/autopilot until M3` (M2c needs no human steps; M3 will ask for `APP_PASSWORD` and `SESSION_SECRET`).
**Gotchas:**
- Production builds warn that `engines.node: 24.x` overrides the project's Node 26 setting — harmless; align them if it ever matters.

## 2026-11-20 — M2b — lib/core: entries, highlights, status transitions, tag lifecycle, soft delete (PR #7)
**State:** done. `lib/core` has `addEntry`, `findDuplicateEntry`, `addHighlight`, `setHighlightNote`, `setHighlightTags`, tag approve/reject/rename/merge/remove, soft delete; 44 new tests (96 total); typecheck, lint, test, build pass. Cuts v0.2.0 (milestone M2).
**Next:** merge PR #7 after the M2 review (`pr-reviewer`, Opus); tag `v0.2.0`; then M3.
**Gotchas:**
- Multi-line heredocs with quotes in the Bash tool failed with "unexpected EOF" and wrote nothing → use the Write tool for files.
- Tests that share one PGlite DB per file collide on tag slugs (existing tags aren't "created") → use unique tag names per test.
- The PGlite Drizzle db is assignable to `Db` (M2a follow-up resolved); `tx.execute` used only for the merge insert-select.
**Doc drift:** data-model constraints 9 and 12 updated (cross-user check, rejected tags per axis, merge rules).
**Follow-ups:** artist linking is not in M2b (M7); search sync calls (`lib/search`) only set `search_dirty`, nothing upserts yet; vector deletion on soft delete waits for `lib/search`; no restore for soft-deleted entries; 30-day purge still has no slice.

## 2026-11-20 — M2a — Drizzle schema, init migration with owner seed, PGlite harness (PR #6)
**State:** done. 15 tables, `0000_init` + seed, `getDb()`, PGlite harness, 52 tests; typecheck, lint, test, build pass locally. Migration not yet run against a real Neon DB.
**Next:** owner adds Neon via Vercel Marketplace (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`) and merges PR #6; confirm `drizzle-kit migrate` works in the Vercel build without `ws` (if not, ask before adding `ws`). Then M2b (`sonnet`, `core-logic`).
**Gotchas:**
- Neon branch-per-preview isn't active; previews share the production DB, so previews never migrate (`vercel-build` migrates only when `VERCEL_ENV=production`).
- Plain `ON CONFLICT DO NOTHING` keeps the target's `added_at`, not the earliest → tag merge uses `DO UPDATE SET added_at = LEAST(...)`.
- `match_status` check also trips when an invalid status has no mbid → enum-check tests must supply an mbid.
- Composite FKs are MATCH SIMPLE: NULL `merged_into` passes. Intended.
**Doc drift:** data-model (decisions, merge pattern, owner name), architecture, CONTRIBUTING, build-plan (M1 marked merged, purge follow-up).
**Follow-ups:** `highlight_tags` cross-user check in `lib/core` (M2b); check PGlite db is assignable to `Db` type; 30-day purge has no slice.

## 2026-11-20 — chore — Autopilot and auto-merge (PR #5)
**State:** done in this PR: `/autopilot` skill, auto-merge policy in CONTRIBUTING and CLAUDE.md, wrap-up enables auto-merge, permission guidance in the build plan, ESLint added to the architecture stack (M1 follow-up).
**Next:** owner, once: merge this PR; Settings → General → tick **Allow auto-merge** and **Automatically delete head branches**; add **Typecheck, lint, test, build** as a required check in the `protect main` ruleset; install GitHub CLI (`winget install GitHub.cli`) and run `gh auth login`. Then: `claude --model sonnet --effort low` → `/autopilot until M2b`. Vercel project and Neon must exist before M2a (autopilot asks).
**Gotchas:**
- Cloud sessions can open PRs but can't merge them, change repo settings or edit permission settings; those need the owner or a local session.
- Auto-merge is only as safe as the required checks: `Typecheck, lint, test, build` was not yet required after M1.

## 2026-11-20 — M1 — App skeleton, /api/health, CI, v0.1.0 (PR #4)
**State:** done. Next.js 16 + TS + Tailwind 4 + Vitest skeleton, `/api/health`, CI job for typecheck/lint/test/build, `vercel-build`, v0.1.0 cut in changelog and `package.json`. All checks pass locally.
**Next:** owner creates the Vercel project, merges PR #4, tags `v0.1.0`, adds the new CI check to branch protection; then start M2a with `claude --model opusplan --effort high`.
**Gotchas:**
- `git commit` failed with no author identity on this machine → set repo-local `user.name`/`user.email` (owner chose their Gmail; consider a noreply address).
- Repo files are CRLF → scripted edits must preserve CRLF; Python needs `PYTHONUTF8=1` and `newline=''` or em dashes get mangled.
- Vitest config as `.ts` warns about ESM in CJS → use `vitest.config.mts`.
**Doc drift:** README status, CONTRIBUTING CI note, build-plan, CHANGELOG updated.
**Follow-ups:** `eslint` + `eslint-config-next` are not listed in architecture Stack; add them to the table.

## 2026-11-20 — chore — Effort levels (PR #3)
**State:** done. Effort column per slice in the build plan (`low` for scaffolding and review sessions, `medium` default, `high` for M2a and M5a); project `effortLevel: medium`; agents and `/wrap-up` pin their own effort.
**Next:** owner pulls, then starts M1 with `claude --model sonnet --effort low`.
**Gotchas:**
- Typing `/effort <level>` saves it as the default; use `/effort auto` or the slider's `s` (session only) to avoid carrying `high` into the next slice.

## 2026-11-20 — chore — Model routing (PR #2)
**State:** done. Project default model `sonnet` (`.claude/settings.json`); M2a and M5a use `opusplan`; reviews run on Haiku with the Opus `pr-reviewer` agent; `/wrap-up` runs on Haiku; CLAUDE.md has a model check that stops and asks when the session model doesn't match the slice.
**Next:** owner clones the repo to `C:\Users\efrai\dev\sound-journal` and starts M1 with `claude --model sonnet` (or just `claude`).
**Gotchas:**
- A session can't switch its own model; only the user can (`/model`, `--model`). Skills switch for one turn only; agents are pinned by their own `model` field.

## 2026-11-20 — M0 — Project documentation (PR #1)
**State:** done. Docs, taxonomy structure, CI stub, build plan, project agents and this skill are in PR #1.
**Next:** owner merges PR #1, turns on branch protection (ruleset on `main`: require PR with 0 approvals, require "Validate taxonomy", block force pushes), clones to `C:\Users\efrai\dev\sound-journal`; then start slice M1.
**Gotchas:**
- Remote tools can't write into a local `.github` folder and can't delete files, so git can't be run on the owner's machine remotely → GitHub is the source of truth; the owner clones locally.
- `gh pr create` fails from cloud sessions (GraphQL blocked) → use `gh api repos/{owner}/{repo}/pulls`.
- Keep the working copy out of OneDrive: syncing `.git` and `node_modules` causes sync errors.
**Follow-ups:** confirm Upstash hosted embeddings are free before M6; choose a license before inviting contributors.
