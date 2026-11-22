# Changelog

What changed in each release, for people using Sound Journal (and the agents they connect). For build history and gotchas, see [docs/dev-log.md](docs/dev-log.md).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Before 1.0, each milestone bumps the minor version; see [Versioning and releases](CONTRIBUTING.md#versioning-and-releases).

## [Unreleased]

### Added
- Song page: one player at the top, a card per clip (tap its time to play from there), Edit for a clip's why and times (with Mark from the player), and Add a clip. Saving a capture now opens the song's page.
- Entry list: search by title, artist or album, and filter by artist, tag, axis and status.
- Settings page with the connector switches (Connector, Allow changes, Allow deletes) and the list of connected apps, each with a Revoke button.

### Changed
- Wrong-password lockout is now per client IP (5 fails, 15 minutes) for both the login page and the connect-an-app page, with a global slow-down (never a lockout) after 50 wrong passwords in an hour.
- App registration is limited to 10 per IP per hour.
- Deleting through the connector now also needs "Allow changes".
- Connect-an-app errors for an unknown app or a mismatched return address show an error page (no link back, "You can close this tab.") instead of redirecting.
- Agents are no longer told about `match_entry` (rule 8) until that tool exists.

- `add_entry` always checks the link with YouTube first (a video that does not exist is refused even when a title is given) and keeps YouTube's raw title and channel.
- Artist names are matched ignoring accents, punctuation and a leading "The", so "Sigur Ros" and "The Sigur Rós" are the same artist.
- Tags added by a connected app now record that app's name.
- Tag names such as `needs_why` or `tagged` (workflow statuses) are refused.
- The Settings page shows times in your time zone, and date filters handle time zones where the clock skips midnight.
- `add_entry` now gives YouTube 5 seconds to answer and refuses, with "couldn't verify the video with YouTube, try again later", when YouTube can't be reached or errors; a private video or one with embedding off still accepts a title you give.
- Using a connect-an-app code a second time now revokes the app it connected (OAuth 2.1).
- The Settings page actions now reject requests from other sites.

### Fixed
- Connecting an agent failed with "Cross-origin request": the consent page sent `Referrer-Policy: no-referrer`, so browsers posted the approval form with `Origin: null`. It now uses `same-origin`.

## [0.5.0] — 2026-11-21

### Added
- Agent tools to change the journal: `add_entry`, `add_highlight`, `update_highlight`, `set_highlight_tags` (new tags start as proposals for you to review) and `restore_deleted`, plus `delete_highlight` and `delete_entry` (soft deletes, restorable for 30 days). Changes need "Allow changes" and deletes need "Allow deletes"; there is no settings page for them yet, so docs/mcp-server.md shows the one SQL line to flip a switch.
- Connected agents now receive the journal's house rules (check the inbox first, reuse tags, never tag a highlight without a note, never invent tracks) when they connect.
- Connect an agent: sign-in for MCP clients (OAuth 2.1 with automatic client registration). The consent page asks for your app password and shows where the app will send you back. Access lasts 1 hour and refreshes for up to 90 days; replaying an old refresh token disconnects the app.
- MCP endpoint at `/api/mcp` for connected agents, with the read tools `list_inbox`, `get_taxonomy`, `search_highlights` (text match on notes until the search index arrives), `get_entry` and `list_entries`. Every tool refuses, naming the switch, when the connector is switched off.
- Deleted entries and highlights are now permanently removed after 30 days, by a daily cleanup job that also clears expired sign-in data.

### Changed
- `search_highlights` reads `from` and `to` as calendar days in your time zone (an evening capture in Toronto counts for that day) and refuses dates that do not exist, like 2026-02-30.
- Agents that hit an unexpected server problem now get a short "try again" message instead of database text.
- Wrong-password attempts are counted atomically, so parallel guesses cannot get past the 5-attempt lockout.
- When 200 apps have registered, a new registration replaces the oldest app that was never connected instead of failing.

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
