import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import pkg from "../../package.json";
import {
  CoreError,
  addEntryForAgent,
  addHighlight,
  restoreEntry,
  restoreHighlight,
  setHighlightTags,
  softDeleteEntry,
  softDeleteHighlight,
  updateHighlight,
  assertConnectorAllows,
  type ConnectorNeed,
  getEntryForAgent,
  getTaxonomy,
  listEntriesForAgent,
  listInbox,
  searchHighlights,
  syncSearchQuietly,
  type AgentEntry,
  type AgentHighlight,
} from "../core";
import type { Db } from "../db";
import { getVectorIndex, type VectorIndex } from "../search";
import type { fetchOEmbed } from "../sources/youtube";

export const MCP_SERVER_NAME = "sound-journal";

type Need = ConnectorNeed;

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
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date written YYYY-MM-DD, such as 2026-01-31.")
  .describe("Calendar date YYYY-MM-DD in the user's time zone");

/**
 * The house rules sent to every connected agent (docs/mcp-server.md, "Server instructions").
 * Rule 8 talks about `match_entry`, so it is sent only when that tool is registered (M7).
 */
export function serverInstructions(tools: { matchEntry: boolean }): string {
  return [...BASE_INSTRUCTIONS, ...(tools.matchEntry ? [MATCH_ENTRY_INSTRUCTION] : [])].join("\n");
}

const BASE_INSTRUCTIONS = [
  "You are connected to the user's Sound Journal: a library of moments in music and why they matter to the user.",
  "1. At the start of any Sound Journal task, call `list_inbox` and mention anything waiting.",
  "2. Before tagging, call `get_taxonomy`. Reuse existing tags when the meaning fits; create new tags only when nothing fits. New tags are proposals the user will review.",
  "3. Tag only what the user's note says. Never tag a highlight with no note — ask the user why they saved it.",
  "4. When the user describes a technique in plain words, use the precise term as the tag and briefly explain it to them.",
  "5. Genres are not tags. Don't tag artist genres.",
  "6. Never invent tracks, links or timestamps. Before saving or suggesting a track, confirm it exists (find its YouTube or Spotify link). If you can't, say so.",
  '7. When saving from a description ("around where the guitars come in"), give your best timestamp and tell the user it\'s approximate so they can adjust it in the app.',
];

const MATCH_ENTRY_INSTRUCTION =
  '8. Match entries to MusicBrainz only when confident; otherwise use `confidence: "low"` and let the user confirm.';

/** Flip to true in M7, in the same change that registers `match_entry`. */
const REGISTERS_MATCH_ENTRY = false;

/** Builds a stateless MCP server for one verified user. Every tool re-checks the connector switches. */
export function createMcpServer(
  db: Db,
  userId: string,
  deps: NonNullable<Parameters<typeof fetchOEmbed>[1]> = {},
  /** The connected app's registered name; recorded as `agent_name` on tags it attaches. */
  clientName: string | null = null,
  /** The vector index (null: not configured). Searches use it, and writes push dirty highlights to it. */
  index: VectorIndex | null = getVectorIndex(),
): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: pkg.version }, { instructions: serverInstructions({ matchEntry: REGISTERS_MATCH_ENTRY }) });

  /** Runs `fn` only when the switches allow it; a CoreError becomes a readable refusal. */
  async function guarded(need: Need, fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
    try {
      await assertConnectorAllows(db, userId, need);
      const result = await fn();
      if (need !== "read") await syncSearchQuietly(db, userId, index);
      return result;
    } catch (e) {
      if (e instanceof CoreError) return refusal(e.message);
      // Never hand raw database or runtime errors to the agent; log them where the owner can see them.
      console.error("MCP tool failed", e);
      return refusal("Something went wrong on the server; try again.");
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
        "Find highlights by filters. `query` searches by meaning (the note, title, artists and tags together), so it works with different words than the note used; each match carries a similarity `score`. Without a search index it falls back to a case-insensitive substring match on notes. All filters combine with AND; `tags` requires every named tag.",
      inputSchema: {
        query: z.string().min(1).max(500).optional(),
        tags: z.array(z.string().min(1).max(100)).max(20).optional().describe("Tag names; a highlight must carry all of them"),
        axis: z.string().optional().describe("Only highlights with a tag on this axis"),
        artist: z.string().optional().describe("Exact artist name, case-insensitive"),
        status: z.enum(["needs_why", "needs_tags", "tagged"]).optional(),
        from: dateInput.optional().describe("Captured on or after this calendar date (YYYY-MM-DD, read in the user's time zone)"),
        to: dateInput.optional().describe("Captured before this calendar date (YYYY-MM-DD, read in the user's time zone; exclusive)"),
        limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
      },
      annotations: readOnly,
    },
    ({ from, to, ...rest }) =>
      guarded("read", async () => {
        const items = await searchHighlights(db, userId, { ...rest, from, to }, index);
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

  const writes = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
  const idempotentWrite = { ...writes, idempotentHint: true } as const;
  const destructive = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;
  const sec = z.number().int().min(0).max(86_400);

  const highlightInput = z.object({
    start_sec: sec.optional().describe("Start in whole seconds; omit for the whole song"),
    end_sec: sec.optional().describe("End in whole seconds, after start_sec"),
    note: z.string().max(5000).optional().describe("The user's own words about why this moment matters; omit if they gave none"),
  });

  server.registerTool(
    "add_entry",
    {
      title: "Add entry",
      description:
        "Save a YouTube link to the journal with optional highlights. If the link is already saved, the highlights are added to the existing entry instead. Pass a clean song `title` and `artists` you are sure of; if `title` is omitted it is read from YouTube, and the call is refused if that fails. A highlight without a note is saved as needs_why.",
      inputSchema: {
        url: z.string().url().describe("A YouTube link (required in v1)"),
        title: z.string().min(1).max(300).optional(),
        artists: z.array(z.string().min(1).max(200)).max(10).optional(),
        album: z.string().min(1).max(300).optional(),
        original_release_year: z.number().int().min(1000).max(3000).optional(),
        highlights: z.array(highlightInput).max(20).optional().describe("Omit for one whole-song highlight"),
      },
      annotations: writes,
    },
    (a) =>
      guarded("changes", async () => {
        const r = await addEntryForAgent(
          db,
          userId,
          {
            url: a.url,
            title: a.title,
            artists: a.artists,
            album: a.album,
            originalReleaseYear: a.original_release_year,
            highlights: a.highlights?.map((h) => ({ startSec: h.start_sec, endSec: h.end_sec, note: h.note })),
          },
          deps,
        );
        const lines = r.highlights.map((h) => `- highlight ${h.id} [${h.status}] ${h.startSec === null ? "whole song" : mmss(h.startSec)}`);
        const head = r.created
          ? `Saved "${r.entry.title}" (entry ${r.entry.id}).`
          : `That link is already saved as "${r.entry.title}" (entry ${r.entry.id}); ${r.highlights.length ? "highlights were added to it" : "nothing was added"}.`;
        const ignored = r.ignored.length ? `\nIgnored: ${r.ignored.join("; ")}.` : "";
        return ok(`${head}${lines.length ? `\n${lines.join("\n")}` : ""}${ignored}`, {
          created: r.created,
          entry: r.entry,
          highlights: r.highlights,
          ignored: r.ignored,
        });
      }),
  );

  server.registerTool(
    "add_highlight",
    {
      title: "Add highlight",
      description: "Add a highlight to a saved entry. A note is optional; without one it is saved as needs_why.",
      inputSchema: { entry_id: z.string().uuid(), ...highlightInput.shape },
      annotations: writes,
    },
    ({ entry_id, start_sec, end_sec, note }) =>
      guarded("changes", async () => {
        const h = await addHighlight(db, userId, entry_id, { startSec: start_sec, endSec: end_sec, note });
        return ok(`Added highlight ${h.id} [${h.status}] to entry ${entry_id}.`, { highlight: h });
      }),
  );

  server.registerTool(
    "update_highlight",
    {
      title: "Update highlight",
      description:
        "Edit a highlight's note and/or times; fields you omit stay as they are, null clears. Changing the note sends it back for tagging (needs_tags), or to needs_why if cleared; tags are kept. Changing only times keeps the status.",
      inputSchema: {
        highlight_id: z.string().uuid(),
        note: z.string().max(5000).nullable().optional(),
        start_sec: sec.nullable().optional(),
        end_sec: sec.nullable().optional(),
      },
      annotations: idempotentWrite,
    },
    ({ highlight_id, note, start_sec, end_sec }) =>
      guarded("changes", async () => {
        const h = await updateHighlight(db, userId, highlight_id, { note, startSec: start_sec, endSec: end_sec });
        return ok(`Updated highlight ${h.id} [${h.status}].`, { highlight: h });
      }),
  );

  server.registerTool(
    "set_highlight_tags",
    {
      title: "Set highlight tags",
      description:
        "Set the highlight's full tag list. Tags already on it are kept, new ones are attached, missing ones are removed. Unknown names are created as proposed tags for the user to review; merged names resolve to the surviving tag. Refused if the highlight has no note (needs_why). An empty list removes all tags.",
      inputSchema: {
        highlight_id: z.string().uuid(),
        tags: z
          .array(z.object({ name: z.string().min(1).max(100), axis: z.string().min(1).max(40) }))
          .max(30)
          .describe("Lowercase names of 1-4 words; axis is an id from get_taxonomy"),
      },
      annotations: idempotentWrite,
    },
    ({ highlight_id, tags }) =>
      guarded("changes", async () => {
        const r = await setHighlightTags(db, userId, highlight_id, tags, { agentName: clientName });
        const text = [
          `Highlight ${r.highlight.id} is now ${r.highlight.status}.`,
          r.added.length ? `Added: ${r.added.map((t) => t.name).join(", ")}.` : "",
          r.created.length ? `New proposed tags: ${r.created.map((t) => t.name).join(", ")}.` : "",
          r.removedTagIds.length ? `Removed ${r.removedTagIds.length} tag(s).` : "",
        ]
          .filter(Boolean)
          .join(" ");
        return ok(text, {
          highlight: r.highlight,
          added: r.added.map((t) => ({ id: t.id, name: t.name, axis: t.axis, state: t.state })),
          created: r.created.map((t) => ({ id: t.id, name: t.name, axis: t.axis, state: t.state })),
          removedTagIds: r.removedTagIds,
        });
      }),
  );

  server.registerTool(
    "delete_highlight",
    {
      title: "Delete highlight",
      description:
        "Soft-delete one highlight (the user can restore it for 30 days). Refused if it is the entry's last highlight; use delete_entry then. Needs the connector's delete switch.",
      inputSchema: { highlight_id: z.string().uuid() },
      annotations: destructive,
    },
    ({ highlight_id }) =>
      guarded("deletes", async () => {
        await softDeleteHighlight(db, userId, highlight_id);
        return ok(`Deleted highlight ${highlight_id}. It can be restored for 30 days.`, { deleted: { highlightId: highlight_id } });
      }),
  );

  server.registerTool(
    "delete_entry",
    {
      title: "Delete entry",
      description:
        "Soft-delete an entry and all its highlights (the user can restore it for 30 days). Pass confirm: true. Needs the connector's delete switch.",
      inputSchema: { entry_id: z.string().uuid(), confirm: z.literal(true).describe("Must be true") },
      annotations: destructive,
    },
    ({ entry_id }) =>
      guarded("deletes", async () => {
        await softDeleteEntry(db, userId, entry_id);
        return ok(`Deleted entry ${entry_id} and its highlights. It can be restored for 30 days.`, { deleted: { entryId: entry_id } });
      }),
  );

  server.registerTool(
    "restore_deleted",
    {
      title: "Restore deleted",
      description:
        "Undo a soft delete within 30 days. Give exactly one of entry_id (restores the entry and the highlights deleted with it) or highlight_id (a single highlight whose entry is still saved).",
      inputSchema: { entry_id: z.string().uuid().optional(), highlight_id: z.string().uuid().optional() },
      annotations: idempotentWrite,
    },
    ({ entry_id, highlight_id }) =>
      guarded("changes", async () => {
        if (!entry_id === !highlight_id) return refusal("Give exactly one of entry_id or highlight_id.");
        if (highlight_id) {
          const h = await restoreHighlight(db, userId, highlight_id);
          return ok(`Restored highlight ${h.id} [${h.status}].`, { restored: { highlight: h } });
        }
        const r = await restoreEntry(db, userId, entry_id!);
        if (!r.restored) {
          return refusal(
            `Not restored: you already have "${r.conflict.title}" (entry ${r.conflict.id}) saved from the same link. The user can choose in the web app whether to move the old highlights onto it.`,
          );
        }
        return ok(`Restored entry "${r.entry.title}" (${r.entry.id}).`, { restored: { entry: r.entry } });
      }),
  );

  return server;
}
