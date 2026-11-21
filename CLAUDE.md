# Sound Journal — instructions for AI coding sessions

Read `README.md`, then the doc for the area you're changing. The docs in `docs/` are the specification: if the code and a doc disagree, stop and ask rather than guessing which is right.

## Working rules
- Never commit to `main`. Work on a branch (`feat/`, `fix/`, `docs/`, `chore/`, `refactor/`) and open a pull request using the template.
- After opening a PR, enable auto-merge (`gh pr merge <n> --squash --auto --delete-branch`) unless the user asked to hold it. Never merge with failing checks or try to bypass the ruleset.
- To build several slices unattended, the user runs `/autopilot [until <slice>]` (`.claude/skills/autopilot/`).
- **Model check, first thing:** look up the slice's **Model** in `docs/build-plan.md` and compare it with the model you are running on. If they differ, stop before planning and tell the user the exact command (e.g. `/model opusplan`). Continue only after they switch or say to proceed anyway. In `opusplan`, being on Opus while planning and Sonnet while implementing is correct.
- Build in the slice order in `docs/build-plan.md`. One slice per session and per PR; read only the docs that slice lists. Tick its status in the same PR.
- End every build session with the `wrap-up` skill (`/wrap-up`) before `/clear`. Start every session by reading the top entry of `docs/dev-log.md`.
- Project subagents live in `.claude/agents/`. Delegate only bounded work to them, with the exact files and doc sections in the brief.
- Update the relevant docs in the same PR as the behavior change. If the change is visible to a user or a connected agent, add a line under `[Unreleased]` in `CHANGELOG.md`.
- The PR that finishes a milestone also cuts its release (see CONTRIBUTING → Versioning and releases).
- Run typecheck, lint, tests and build before calling anything done (once M1 exists).
- Ask before adding a dependency not listed in `docs/architecture.md`, and justify it in the PR.
- The repo is public: no secrets, no real journal data, no personal data in code, fixtures or commits.

## Architecture rules (from docs/architecture.md)
- Business rules live only in `lib/core`. Pages, API routes and MCP tools are thin wrappers that call `lib/core`.
- Only `lib/db` imports the Postgres client. Only `lib/search` imports the vector client.
- External services are adapters in `lib/sources/` and `lib/metadata/`.
- Every query on personal data is scoped by `user_id`, even in single-user v1. Only `artists` and `artist_genres` (shared reference data) are exempt.
- Postgres is the source of truth; the vector index is derived and must be rebuildable.

## Data rules (from docs/data-model.md and docs/taxonomy.md)
- Tags live on highlights, never on entries.
- Workflow status (`needs_why`, `needs_tags`, `tagged`) is never a tag.
- Genres live in `artist_genres`, never in `tags`.
- Agent-created tags start as `proposed`. `set_highlight_tags` diffs; it never resets `added_at` on kept tags.
- Deletes are soft (`deleted_at`); an entry always keeps at least one live highlight.
- Schema changes are Drizzle migrations; never edit a migration that has run in production; prefer expand-then-contract.
- `visibility` must be `private` in v1.

## Product rules
- No AI API keys in the app. AI features run in the user's agent through MCP.
- Never fabricate tracks, links, timestamps or metadata. Unverified matches stay `unmatched`.
- Capture must stay fast: a note is never required to save.
- Mobile-first: check ~375px wide; tap targets at least 44×44px.

## Gotchas
Short, durable lessons promoted from `docs/dev-log.md` by the wrap-up skill. Keep under 15 lines.
- Cloud sessions can't use `gh pr create` (GraphQL blocked); open PRs with `gh api repos/{owner}/{repo}/pulls`.
- Neon branch-per-preview isn't active; previews share the production DB, so previews never migrate (only `VERCEL_ENV=production` runs `drizzle-kit migrate`).
- The working copy lives outside OneDrive (`C:\Users\efrai\dev\sound-journal`); don't move it into a synced folder.
- In the Bash tool, heredocs or long `node -e` strings containing quotes can fail with "unexpected EOF" and write nothing; create files and scripts with the Write tool. Working-copy files are CRLF, so use the Edit tool (or normalize line endings) for multi-line replacements.
- Working-copy files are CRLF (`core.autocrlf`): scripted multi-line string replaces silently match nothing; use the Edit tool.
- No Python on this machine: edit files with sed, Edit or Write, not `python3`. A `sed` script that contains `#` inside the replacement text breaks when `#` is the delimiter; use `|` or the Edit tool.
- Several `lib/http/*` handlers take an injected `db`, so route files stay one-liners and the logic is tested on PGlite; new routes should follow that.
- Next 16 calls middleware `proxy.ts` (Node runtime); the auth gate lives there.
