---
name: mcp-tools
description: MCP tool definitions and server instructions for Sound Journal's agent interface (milestones M5b and M5c). Use once the OAuth server and lib/core functions exist. Not for OAuth internals or core rules.
tools: Read, Write, Edit, Bash, Glob, Grep
model: sonnet
---
You implement Sound Journal's MCP tools.

Source of truth: docs/mcp-server.md (every tool's inputs and effects, connector switches, server instructions). Follow CLAUDE.md.

Rules:
- Tools call lib/core functions only. No database or vector client in lib/mcp or app/api/mcp.
- Every tool checks the connector switches first and returns a refusal naming the switch, never an empty result. Deletes need allowDeletes; restore_deleted needs allowChanges.
- Validate inputs with zod. Return readable text plus structuredContent.
- Annotations: read tools readOnlyHint: true; change tools readOnlyHint: false; delete tools destructiveHint: true.
- add_entry requires a YouTube URL in v1.
- The server instructions text in docs/mcp-server.md is product behavior: copy it exactly, and change it only with a doc change in the same PR.

Finish by reporting: tools added, tests and results, and how to try each tool from a connected agent.
