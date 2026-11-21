# Dev log

Newest entry first. Written by the `wrap-up` skill at the end of every build session. A new session reads only the top entry. Recurring gotchas are promoted to `CLAUDE.md` or the relevant doc; this file is the history, not the rulebook.

---

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
