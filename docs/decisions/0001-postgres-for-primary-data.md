# 0001 — Postgres (Neon) for primary data

**Status:** accepted · 2026-11-20

## Context
The data is relational: entries have highlights, highlights have tags, tags have axes, entries have artists. Core queries are relational too ("every highlight tagged *interlocking guitars*", "tag co-occurrence by month"). The owner's macro-log app uses Upstash Redis, and Upstash's free plan allows one Redis database per account, which macro-log already uses.

## Decision
Use Neon Postgres (free plan) via the Vercel Marketplace, with Drizzle for typed queries and migrations.

## Consequences
- Tag filters, joins and taste-map aggregates are plain SQL instead of hand-maintained Redis index sets.
- Migrations are explicit and versioned in git.
- Neon branches give each preview deployment its own copy of the database.
- One more service to manage (same login email, connected through Vercel).

## Alternatives considered
- **Share macro-log's Redis database with a key prefix** — free, but macro-log's nightly backup copies every key, so journal data would land in macro-log backups and a macro-log restore could overwrite it; the apps would share one usage quota.
- **A second Upstash account** — works, but splits management, and creating extra accounts to exceed free limits may conflict with the provider's terms.
- **Upstash Vector metadata as the only store** — possible but awkward for listing, editing and relational queries.
