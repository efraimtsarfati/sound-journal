# Changelog

What changed in each release, for people using Sound Journal (and the agents they connect). For build history and gotchas, see [docs/dev-log.md](docs/dev-log.md).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Before 1.0, each milestone bumps the minor version; see [Versioning and releases](CONTRIBUTING.md#versioning-and-releases).

## [Unreleased]

### Added
- Connect an agent: sign-in for MCP clients (OAuth 2.1 with automatic client registration). The consent page asks for your app password and shows where the app will send you back. Access lasts 1 hour and refreshes for up to 90 days; replaying an old refresh token disconnects the app.
- Deleted entries and highlights are now permanently removed after 30 days, by a daily cleanup job that also clears expired sign-in data.

### Changed
- Wrong-password attempts are counted atomically, so parallel guesses cannot get past the 5-attempt lockout.

## [0.4.0] — 2026-11-21

### Added
- Journal home (`/`): inbox counts ("N need a why, N need tags") and the entry list, newest first, with each highlight's status, note and tags.
- Entry detail (`/entries/<id>`): each highlight plays from its timestamp, remove a tag from a highlight, delete a highlight or the whole entry, add another highlight.
- Tag review (`/tags`): approve, reject, rename or merge the tags your agent proposed.
- Deleted (`/deleted`): restore a deleted entry. If you've since saved the same video again, it offers to move the old highlights onto the new entry instead.
- JSON export (`/api/export`): all your entries, highlights and tags, including deleted ones not yet purged.

### Added
- Capture screen (`/capture`): paste a YouTube link, watch it in the page, mark a start and end while it plays (or type them), add an optional note, and save. A link already in the journal adds a highlight to the existing entry. Videos that can't be embedded show a link to YouTube and typed times.

## [0.3.0] — 2026-11-21

### Added
- Owner login: password page, signed 30-day session cookie, and a 15-minute lockout after 5 wrong passwords. Every page and API route now requires a session, except sign-in, health, and the paths that authenticate themselves (OAuth, MCP, cron).

## [0.2.0] — 2026-11-20

### Added
- Database schema (15 tables) with the first migration and owner seed.
- Core journal rules: saving entries with a first highlight, duplicate detection by source, note-driven status transitions, tag lifecycle (propose, approve, reject, rename, merge), diff-based tagging, and soft delete that keeps at least one highlight per entry. Not yet reachable from the app or an agent.

## [0.1.0] — 2026-11-20

### Added
- Project documentation: vision, v1 spec, architecture, data model, taxonomy (with `taxonomy/axes.json`), MCP server design, roadmap, build plan, engineering workflow, decision records and research notes.
- CI check that validates the taxonomy file.
- App skeleton (Next.js, TypeScript, Tailwind) with `/api/health`, which returns the running version.
- CI checks for typecheck, lint, tests and build.
- Claude Code project agents, the `wrap-up` skill and the dev log.
