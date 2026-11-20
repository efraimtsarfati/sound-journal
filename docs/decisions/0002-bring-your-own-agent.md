# 0002 — Bring your own agent (no AI API key in the app)

**Status:** accepted · 2026-11-20

## Context
The app needs AI for tagging notes, voice capture, metadata matching, discovery and "how do I play this?". Calling an AI API from the app means paying per call and choosing a provider for every user. The owner wants the app free to run, and wants other people to be able to connect their own agent.

## Decision
The app contains no AI calls. It exposes a remote MCP server with OAuth; the user's own agent (Claude or any MCP client) does all AI work through the tools in `docs/mcp-server.md`. Search by meaning uses hosted embeddings in the vector database (ADR 0003), which is not an AI API key.

## Consequences
- Free to run; users choose their AI.
- Voice capture comes for free through the agent's own voice mode.
- Highlights saved in the web app aren't tagged until the agent processes them. The inbox (`needs_why` / `needs_tags`) and an optional scheduled task in the agent handle this.
- The server instructions are part of the product: they're how tagging rules reach every agent.
- An MCP server can't push to an agent; anything "automatic" must be scheduled on the agent side.

## Alternatives considered
- **In-app AI with an API key** — automatic tagging at save time, but ongoing cost and a single provider.
