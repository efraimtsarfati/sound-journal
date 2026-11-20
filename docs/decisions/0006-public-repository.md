# 0006 — Public repository

**Status:** accepted · 2026-11-20

## Context
The owner wants a real pull-request workflow with enforced checks, at no cost. On GitHub Free, branch protection is available for public repositories (private repositories need a paid plan).

## Decision
The repository is public.

## Consequences
- Branch protection can require PRs and passing checks before merging into `main`.
- Anyone can read the code; the project doubles as a portfolio piece.
- Secrets must never be committed (they live in Vercel), and real journal data never enters the repo. A leaked secret must be rotated, not just deleted.
- A license should be chosen before inviting contributions.
