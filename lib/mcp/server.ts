import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import pkg from "../../package.json";
import {
  CoreError,
  getConnectorSettings,
  getEntryForAgent,
  getTaxonomy,
  listEntriesForAgent,
  listInbox,
  searchHighlights,
  type AgentEntry,
  type AgentHighlight,
} from "../core";
import type { Db } from "../db";

export const MCP_SERVER_NAME = "sound-journal";

type Need = "read" | "changes" | "deletes";

const SWITCH_NAME = {
  read: "Connector -> Enabled",
  changes: "Connector -> Allow changes",
  deletes: "Connector -> Allow deletes",
} as const;

function refusal(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** JSON-safe copy (dates become ISO strings) for structuredContent. */
function plain<T extends object>(value: T): { [k: string]: unknown } {
  return JSON.parse(JSON.stringify(value));
}

function ok(text: string, data: object): CallToolResult {
  return { content: [{ type: "text", text }], structuredContent: plain(data) };
}

function mmss(sec: number | null): string {
  if (sec === null) return "whole song";
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function when(h: AgentHighlight): string {
  if (h.startSec === null) return "whole song";
  return h.endSec === null ? `at ${mmss(h.startSec)}` : `${mmss(h.startSec)}-${mmss(h.endSec)}`;
}

function describeHighlight(h: AgentHighlight): string {
  const who = h.entry.artists.length ? `${h.entry.artists.join(", ")} - ` : "";
  const tagText = h.tags.length ? ` tags: ${h.tags.map((t) => `${t.name} (${t.axis}${t.state === "proposed" ? ", proposed" : ""})`).join(", ")}` : "";
  const note = h.note ? ` "${h.note}"` : " (no note yet)";
  return `- [${h.status}] ${who}${h.entry.title} ${when(h)}${note}${tagText} (highlight ${h.id}, entry ${h.entry.id}${h.entry.url ? `, ${h.entry.url}` : ""})`;
}

function describeEntry(e: AgentEntry): string {
  const who = e.artists.map((a) => a.name).join(", ");
  const genres = [...new Set(e.artists.flatMap((a) => a.genres))];
  const head = `${who ? `${who} - ` : ""}${e.entry.title} (entry ${e.entry.id}, ${e.entry.matchStatus}${genres.length ? `, genres: ${genres.join(", ")}` : ""})`;
  const urls = e.sources.map((s) => `  source: ${s.url}`);
  const hl = e.highlights.map((h) => `  ${describeHighlight(h)}`);
  return [head, ...urls, ...hl].join("\n");
}

const dateInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/, "Use an ISO date such as 2026-01-31.")
  .describe("ISO date (YYYY-MM-DD)");

/** Builds a stateless MCP server for one verified user. Every tool re-checks the connector switches. */
export function createMcpServer(db: Db, userId: string): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: pkg.version });

  /** Runs `fn` only when the switches allow it; a CoreError becomes a readable refusal. */
  async function guarded(need: Need, fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
    const s = await getConnectorSettings(db, userId);
    if (!s.enabled) {
      return refusal(`The Sound Journal connector is switched off. Ask the user to turn on "${SWITCH_NAME.read}" in the web app settings.`);
    }
    if (need === "changes" && !s.allowChanges) {
      return refusal(`Changes through the connector are switched off. Ask the user to turn on "${SWITCH_NAME.changes}" in the web app settings.`);
    }
    if (need === "deletes" && !s.allowDeletes) {
      return refusal(`Deleting through the connector is switched off. Ask the user to turn on "${SWITCH_NAME.deletes}" in the web app settings.`);
    }
    try {
      return await fn();
    } catch (e) {
      if (e instanceof CoreError) return refusal(e.message);
      throw e;
    }
  }

  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

  server.registerTool(
    "list_inbox",
    {
      title: "List inbox",
      description:
        "Highlights waiting on the user: needs_why (saved without a note) and needs_tags (has a note, not tagged yet), oldest first.",
      inputSchema: { limit: z.number().int().min(1).max(200).optional().describe("Default 50") },
      annotations: readOnly,
    },
    ({ limit }) =>
      guarded("read", async () => {
        const items = await listInbox(db, userId, { limit });
        const text = items.length
          ? `${items.length} highlight(s) in the inbox:\n${items.map(describeHighlight).join("\n")}`
          : "The inbox is empty.";
        return ok(text, { highlights: items });
      }),
  );

  server.registerTool(
    "get_taxonomy",
    {
      title: "Get taxonomy",
      description:
        "The tag axes, every approved and proposed tag with its axis, state and usage count, and rejected tag slugs. Call before tagging and reuse existing tags when the meaning fits.",
      inputSchema: {},
      annotations: readOnly,
    },
    () =>
      guarded("read", async () => {
        const t = await getTaxonomy(db, userId);
        const lines = t.axes.map((a) => {
          const own = t.tags.filter((x) => x.axis === a.id);
          const list = own.length ? own.map((x) => `${x.name} (${x.state}, ${x.uses})`).join(", ") : "no tags yet";
          return `${a.id} - ${a.question} ${list}`;
        });
        const rejected = t.rejected.length ? `\nRejected (do not recreate): ${t.rejected.map((r) => `${r.axis}/${r.slug}`).join(", ")}` : "";
        return ok(`${lines.join("\n")}${rejected}`, {
          axes: t.axes,
          tags: t.tags.map((x) => ({ id: x.id, axis: x.axis, name: x.name, state: x.state, uses: x.uses, description: x.description })),
          rejected: t.rejected,
        });
      }),
  );

  server.registerTool(
    "search_highlights",
    {
      title: "Search highlights",
      description:
        "Find highlights by filters. `query` matches the user's note text (case-insensitive substring for now; meaning search arrives with the search index and then adds a similarity score). All filters combine with AND; `tags` requires every named tag.",
      inputSchema: {
        query: z.string().min(1).max(500).optional(),
        tags: z.array(z.string().min(1).max(100)).max(20).optional().describe("Tag names; a highlight must carry all of them"),
        axis: z.string().optional().describe("Only highlights with a tag on this axis"),
        artist: z.string().optional().describe("Exact artist name, case-insensitive"),
        status: z.enum(["needs_why", "needs_tags", "tagged"]).optional(),
        from: dateInput.optional().describe("Captured on or after (ISO date)"),
        to: dateInput.optional().describe("Captured before this date (ISO date, exclusive)"),
        limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
      },
      annotations: readOnly,
    },
    ({ from, to, ...rest }) =>
      guarded("read", async () => {
        const f = from ? new Date(from) : undefined;
        const t = to ? new Date(to) : undefined;
        if ((f && Number.isNaN(f.getTime())) || (t && Number.isNaN(t.getTime()))) {
          return refusal("from and to must be valid ISO dates.");
        }
        const items = await searchHighlights(db, userId, { ...rest, from: f, to: t });
        const text = items.length ? `${items.length} match(es):\n${items.map(describeHighlight).join("\n")}` : "No matching highlights.";
        return ok(text, { highlights: items });
      }),
  );

  server.registerTool(
    "get_entry",
    {
      title: "Get entry",
      description: "One saved entry with its sources, artists, genres and all live highlights. Give exactly one of entry_id or url (a YouTube link).",
      inputSchema: { entry_id: z.string().uuid().optional(), url: z.string().url().optional() },
      annotations: readOnly,
    },
    ({ entry_id, url }) =>
      guarded("read", async () => {
        const e = await getEntryForAgent(db, userId, { entryId: entry_id, url });
        if (!e) return refusal("No saved entry matches that.");
        return ok(describeEntry(e), { entry: e });
      }),
  );

  server.registerTool(
    "list_entries",
    {
      title: "List entries",
      description: "Saved entries, newest first. Pass the returned nextCursor as `cursor` for the next page.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
        cursor: z.string().max(20).optional(),
        artist: z.string().optional().describe("Exact artist name, case-insensitive"),
      },
      annotations: readOnly,
    },
    (args) =>
      guarded("read", async () => {
        const page = await listEntriesForAgent(db, userId, args);
        const text = page.items.length
          ? `${page.items.map(describeEntry).join("\n")}${page.nextCursor ? `\nMore available: cursor ${page.nextCursor}` : ""}`
          : "No entries.";
        return ok(text, { entries: page.items, nextCursor: page.nextCursor });
      }),
  );

  return server;
}
