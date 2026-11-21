import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pkceS256, randomToken } from "../auth/crypto";
import {
  OWNER_USER_ID,
  addEntry,
  exchangeAuthorizationCode,
  issueAuthorizationCode,
  registerClient,
  setHighlightTags,
  softDeleteEntry,
} from "../core";
import { entryArtists, oauthTokens, settings, type Db } from "../db";
import { createTestDb, insertArtist } from "../db/test-utils";
import { handleMcp } from "./mcp";

const ORIGIN = "https://journal.example.test";
const ENV = { APP_ORIGIN: ORIGIN };
const REDIRECT = "https://agent.example.test/callback";

let t: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
let token: string;
let refreshToken: string;
let entryId: string;
let needsWhyId: string;
let taggedId: string;

beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Db;
  const client = await registerClient(db, { name: "Test Agent", redirectUris: [REDIRECT] });
  const verifier = randomToken();
  const code = await issueAuthorizationCode(db, OWNER_USER_ID, {
    clientId: client!.id,
    redirectUri: REDIRECT,
    codeChallenge: pkceS256(verifier),
  });
  const r = await exchangeAuthorizationCode(db, {
    code,
    clientId: client!.id,
    redirectUri: REDIRECT,
    codeVerifier: verifier,
  });
  if (!r.ok) throw new Error("exchange failed");
  token = r.accessToken;
  refreshToken = r.refreshToken;

  const first = await addEntry(db, OWNER_USER_ID, {
    title: "Made Up Song",
    source: { type: "youtube", externalId: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    highlight: { startSec: 75, note: "two guitars circling each other" },
  });
  if (first.duplicate) throw new Error("dup");
  entryId = first.entry.id;
  taggedId = first.highlight.id;
  await setHighlightTags(db, OWNER_USER_ID, taggedId, [{ name: "interlocking guitars", axis: "technique" }]);
  const artist = await insertArtist(t.db, { name: "Imaginary Band", nameNormalized: "imaginary band" });
  await t.db.insert(entryArtists).values({ entryId, artistId: artist.id, role: "primary", position: 0 });

  const second = await addEntry(db, OWNER_USER_ID, {
    title: "Another Made Up Song",
    source: { type: "youtube", externalId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" },
    highlight: { startSec: 10 },
  });
  if (second.duplicate) throw new Error("dup");
  needsWhyId = second.highlight.id;
});
afterAll(() => t.close());

function rpc(method: string, params: unknown, opts: { auth?: string | null; verb?: string; id?: number } = {}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  const auth = opts.auth === undefined ? `Bearer ${token}` : opts.auth;
  if (auth) headers.authorization = auth;
  return new Request(`${ORIGIN}/api/mcp`, {
    method: opts.verb ?? "POST",
    headers,
    body: (opts.verb ?? "POST") === "POST" ? JSON.stringify({ jsonrpc: "2.0", id: opts.id ?? 1, method, params }) : undefined,
  });
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await handleMcp(rpc("tools/call", { name, arguments: args }), db, ENV);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    result: { content: { text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
  };
  return body.result;
}

describe("auth and transport", () => {
  const meta = `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`;

  it("401 with resource_metadata when the token is missing", async () => {
    const res = await handleMcp(rpc("tools/list", {}, { auth: null }), db, ENV);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(meta);
  });

  it("401 for a wrong token, a malformed header and a refresh token", async () => {
    for (const auth of ["Bearer nope", "Basic abc", "Bearer", `Bearer ${refreshToken}`]) {
      const res = await handleMcp(rpc("tools/list", {}, { auth }), db, ENV);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe(meta);
    }
  });

  it("401 for an expired access token", async () => {
    await db.update(oauthTokens).set({ expiresAt: new Date(0) }).where(eq(oauthTokens.kind, "access"));
    const res = await handleMcp(rpc("tools/list", {}), db, ENV);
    expect(res.status).toBe(401);
    await db.update(oauthTokens).set({ expiresAt: new Date(Date.now() + 3_600_000) }).where(eq(oauthTokens.kind, "access"));
  });

  it("503 when APP_ORIGIN is not configured", async () => {
    expect((await handleMcp(rpc("tools/list", {}), db, {})).status).toBe(503);
  });

  it("GET and DELETE are 405 (no SSE), after authentication", async () => {
    for (const verb of ["GET", "DELETE"]) {
      const res = await handleMcp(rpc("", {}, { verb }), db, ENV);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
    expect((await handleMcp(rpc("", {}, { verb: "GET", auth: null }), db, ENV)).status).toBe(401);
  });

  it("initialize reports the server name and package version, JSON not SSE", async () => {
    const res = await handleMcp(
      rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }),
      db,
      ENV,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { result: { serverInfo: { name: string; version: string } } };
    expect(body.result.serverInfo.name).toBe("sound-journal");
    expect(body.result.serverInfo.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("lists the five read tools, all read-only", async () => {
    const res = await handleMcp(rpc("tools/list", {}), db, ENV);
    const body = (await res.json()) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
    expect(body.result.tools.map((x) => x.name).sort()).toEqual(
      ["get_entry", "get_taxonomy", "list_entries", "list_inbox", "search_highlights"],
    );
    expect(body.result.tools.every((x) => x.annotations.readOnlyHint)).toBe(true);
  });
});

describe("read tools", () => {
  it("list_inbox returns only highlights waiting on the user", async () => {
    const r = await call("list_inbox");
    const hs = (r.structuredContent as { highlights: { id: string; status: string }[] }).highlights;
    expect(hs.map((h) => h.id)).toEqual([needsWhyId]);
    expect(hs[0].status).toBe("needs_why");
    expect(r.content[0].text).toContain("no note yet");
  });

  it("get_taxonomy lists axes and tags with usage", async () => {
    const r = await call("get_taxonomy");
    const s = r.structuredContent as { axes: unknown[]; tags: { name: string; state: string; uses: number }[] };
    expect(s.axes.length).toBeGreaterThan(0);
    expect(s.tags).toEqual([expect.objectContaining({ name: "interlocking guitars", state: "proposed", uses: 1 })]);
  });

  it("search_highlights filters by tag, axis, artist, status, query and date", async () => {
    const ids = async (a: Record<string, unknown>) =>
      ((await call("search_highlights", a)).structuredContent as { highlights: { id: string }[] }).highlights.map((h) => h.id);
    expect(await ids({ tags: ["Interlocking Guitars"] })).toEqual([taggedId]);
    expect(await ids({ axis: "technique" })).toEqual([taggedId]);
    expect(await ids({ axis: "sound" })).toEqual([]);
    expect(await ids({ artist: "imaginary band" })).toEqual([taggedId]);
    expect(await ids({ status: "needs_why" })).toEqual([needsWhyId]);
    expect(await ids({ query: "CIRCLING" })).toEqual([taggedId]);
    expect(await ids({ query: "100%" })).toEqual([]);
    expect(await ids({ from: "2999-01-01" })).toEqual([]);
    expect(await ids({ to: "2999-01-01" })).toHaveLength(2);
  });

  it("search_highlights refuses an unknown axis and a bad date readably", async () => {
    expect((await call("search_highlights", { axis: "nonsense" })).isError).toBe(true);
    expect((await call("search_highlights", { from: "2026-99-99" })).isError).toBe(true);
  });

  it("get_entry by id and by YouTube URL; exactly one selector", async () => {
    const a = await call("get_entry", { entry_id: entryId });
    expect(a.content[0].text).toContain("Imaginary Band");
    const b = await call("get_entry", { url: "https://youtu.be/dQw4w9WgXcQ?t=5" });
    expect((b.structuredContent as { entry: { entry: { id: string } } }).entry.entry.id).toBe(entryId);
    expect((await call("get_entry", {})).isError).toBe(true);
    expect((await call("get_entry", { url: "https://example.com/x" })).isError).toBe(true);
    expect((await call("get_entry", { entry_id: "00000000-0000-4000-8000-0000000000ff" })).isError).toBe(true);
  });

  it("list_entries pages with a cursor and filters by artist", async () => {
    const p1 = (await call("list_entries", { limit: 1 })).structuredContent as { entries: unknown[]; nextCursor: string | null };
    expect(p1.entries).toHaveLength(1);
    expect(p1.nextCursor).toBe("1");
    const p2 = (await call("list_entries", { limit: 1, cursor: p1.nextCursor! })).structuredContent as { entries: unknown[]; nextCursor: string | null };
    expect(p2.entries).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    const byArtist = (await call("list_entries", { artist: "Imaginary Band" })).structuredContent as { entries: unknown[] };
    expect(byArtist.entries).toHaveLength(1);
  });

  it("deleted entries disappear from every read tool", async () => {
    const gone = await addEntry(db, OWNER_USER_ID, {
      title: "Soon Gone",
      source: { type: "youtube", externalId: "zzzzzzzzzzz", url: "https://www.youtube.com/watch?v=zzzzzzzzzzz" },
      highlight: { note: "temporary" },
    });
    if (gone.duplicate) throw new Error("dup");
    await softDeleteEntry(db, OWNER_USER_ID, gone.entry.id);
    expect((await call("get_entry", { entry_id: gone.entry.id })).isError).toBe(true);
    const all = (await call("search_highlights", { query: "temporary" })).structuredContent as { highlights: unknown[] };
    expect(all.highlights).toHaveLength(0);
  });
});

describe("connector switches", () => {
  it("a disabled connector refuses every tool, naming the switch", async () => {
    await db.update(settings).set({ mcpEnabled: false }).where(eq(settings.userId, OWNER_USER_ID));
    for (const name of ["list_inbox", "get_taxonomy", "search_highlights", "get_entry", "list_entries"]) {
      const r = await call(name, name === "get_entry" ? { entry_id: entryId } : {});
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("Enabled");
      expect(r.structuredContent).toBeUndefined();
    }
    await db.update(settings).set({ mcpEnabled: true }).where(eq(settings.userId, OWNER_USER_ID));
    expect((await call("list_inbox")).isError).toBeUndefined();
  });

  it("read tools still work with changes and deletes switched off", async () => {
    await db.update(settings).set({ mcpAllowChanges: false, mcpAllowDeletes: false }).where(eq(settings.userId, OWNER_USER_ID));
    expect((await call("list_inbox")).isError).toBeUndefined();
    await db.update(settings).set({ mcpAllowChanges: true }).where(eq(settings.userId, OWNER_USER_ID));
  });
});
