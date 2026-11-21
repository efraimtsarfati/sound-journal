# Changelog

What changed in each release, for people using Sound Journal (and the agents they connect). For build history and gotchas, see [docs/dev-log.md](docs/dev-log.md).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Before 1.0, each milestone bumps the minor version; see [Versioning and releases](CONTRIBUTING.md#versioning-and-releases).

## [Unreleased]

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
