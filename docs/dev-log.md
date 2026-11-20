# Dev log

Newest entry first. Written by the `wrap-up` skill at the end of every build session. A new session reads only the top entry. Recurring gotchas are promoted to `CLAUDE.md` or the relevant doc; this file is the history, not the rulebook.

---

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
