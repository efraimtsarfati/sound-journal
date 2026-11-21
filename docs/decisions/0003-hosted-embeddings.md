# 0003 — Upstash Vector with a hosted embedding model for meaning search

**Status:** accepted · 2026-11-20

## Context
Users describe the same quality in different words ("weaving guitars", "two fairies floating around each other"). Tag or keyword matching can't connect them; search by meaning (embeddings) can. ADR 0002 rules out an embedding API key in the app.

## Decision
Use Upstash Vector (free plan) with an embedding model chosen when the index is created, so the app upserts and queries raw text and Upstash does the embedding. One vector per highlight; Postgres remains the source of truth and the index can be rebuilt.

## Consequences
- No embedding API key; free tier allows 10K queries and updates per day.
- As of November 2026, Upstash's docs list one hosted dense model, `openai/text-embedding-3-small` (1536 dimensions), which fits the free tier's 1536-dimension cap. The older BGE models are no longer offered for new indexes. Upstash's pricing page doesn't mention embedding costs, but the index was created on the Free plan with this model and no card on file (2026-11-21). A Free index only moves to pay-as-you-go once a card is added, so embedding costs nothing for v1.
- The embedding model is fixed per index; changing models means creating a new index and re-syncing from Postgres.
- Word clouds are a display feature, not the search mechanism.

## Alternatives considered
- **Postgres full-text search only** — no meaning matching.
- **pgvector in Neon** — keeps one database, but needs an embedding API to create vectors.
