/* eslint-disable @typescript-eslint/no-explicit-any -- tool results are untyped JSON in these tests */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pkceS256, randomToken } from "../auth/crypto";
import {
  OWNER_USER_ID,
  addEntry,
  exchangeAuthorizationCode,
  issueAuthorizationCode,
  listEntriesForAgent,
  registerClient,
} from "../core";
import { artists, entryArtists, entrySources, highlightTags, highlights, settings, type Db } from "../db";
import { createTestDb, insertArtist, insertEntry, insertHighlight, insertTag, insertUser } from "../db/test-utils";
import { handleMcp } from "./mcp";

const ORIGIN = "https://journal.example.test";
const ENV = { APP_ORIGIN: ORIGIN };
const REDIRECT = "https://agent.example.test/callback";
const yt = (id: string) => `https://www.youtube.com/watch?v=${id}`;

let t: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
let token: string;

// A second user whose data must stay invisible and untouchable.
let otherEntryId: string;
let otherHighlightId: string;
let otherDeletedHighlightId: string;
let otherDeletedEntryId: string;
let otherTagId: string;

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
  const r = await exchangeAuthorizationCode(db, { code, clientId: client!.id, redirectUri: REDIRECT, codeVerifier: verifier });
  if (!r.ok) throw new Error("exchange failed");
  token = r.accessToken;
  await db.update(settings).set({ mcpAllowDeletes: true }).where(eq(settings.userId, OWNER_USER_ID));

  const other = await insertUser(t.db, { displayName: "Someone Else" });
  const e = await insertEntry(t.db, { userId: other.id, title: "Other Persons Song" });
  otherEntryId = e.id;
  await t.db.insert(entrySources).values({ entryId: e.id, type: "youtube", externalId: "otheruser01", url: yt("otheruser01") });
  const h = await insertHighlight(t.db, { entryId: e.id, userId: other.id, note: "secret zebra note", status: "tagged", startSec: 5 });
  otherHighlightId = h.id;
  const h2 = await insertHighlight(t.db, { entryId: e.id, userId: other.id, note: "second", status: "needs_tags", startSec: 9 });
  const tag = await insertTag(t.db, { userId: other.id, name: "zebra tag", slug: "zebra-tag", axis: "sound", state: "approved" });
  otherTagId = tag.id;
  await t.db.insert(highlightTags).values({ highlightId: h.id, tagId: tag.id, addedBy: "agent" });
  const a = await insertArtist(t.db, { name: "Zebra Band", nameNormalized: "zebra band" });
  await t.db.insert(entryArtists).values({ entryId: e.id, artistId: a.id, role: "primary", position: 0 });
  await t.db.update(highlights).set({ deletedAt: new Date() }).where(eq(highlights.id, h2.id));
  otherDeletedHighlightId = h2.id;
  const de = await insertEntry(t.db, { userId: other.id, title: "Other Deleted", deletedAt: new Date() });
  otherDeletedEntryId = de.id;
  await insertHighlight(t.db, { entryId: de.id, userId: other.id, deletedAt: de.deletedAt });
});
afterAll(() => t.close());

function rpc(method: string, params: unknown) {
  return new Request(`${ORIGIN}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

/** Stands in for YouTube's oEmbed: ids starting MISSING are 404, PRIVATE are 401, the rest exist. */
const seenSignals: (AbortSignal | undefined)[] = [];
const fakeFetch = async (input: string, init?: { signal?: AbortSignal }) => {
  const id = /v%3D([^&]+)/.exec(input)?.[1] ?? "";
  seenSignals.push(init?.signal);
  if (id.startsWith("NETDOWN")) throw new Error("network down");
  const status = id.startsWith("MISSING")
    ? 404
    : id.startsWith("PRIVATE")
      ? 401
      : id.startsWith("FORBID")
        ? 403
        : id.startsWith("SERVERR")
          ? 503
          : 200;
  return {
    ok: status === 200,
    status,
    json: async () => ({ title: `${id} Raw Title (Official Video)`, author_name: "Raw Channel" }),
  };
};

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await handleMcp(rpc("tools/call", { name, arguments: args }), db, ENV, { fetch: fakeFetch });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    result: { content: { text: string }[]; structuredContent?: Record<string, any>; isError?: boolean };
  };
  return body.result;
}

describe("server instructions", () => {
  it("initialize sends the house rules", async () => {
    const res = await handleMcp(
      rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }),
      db,
      ENV,
    );
    const body = (await res.json()) as { result: { instructions: string } };
    expect(body.result.instructions).toContain("call `list_inbox`");
    expect(body.result.instructions).toContain("Never tag a highlight with no note");
    // rule 8 is sent because match_entry is registered (M7)
    expect(body.result.instructions).toContain("8. Match entries");
  });
});

describe("change tools", () => {
  let entryId: string;
  let hlId: string;

  it("add_entry saves a link with highlights, artists and metadata", async () => {
    const r = await call("add_entry", {
      url: "https://youtu.be/AAAAAAAAAAA?t=3",
      title: "Made Up Tune",
      artists: ["Imaginary Band", "imaginary  band", "Guest"],
      album: "Pretend",
      original_release_year: 1985,
      highlights: [{ start_sec: 30, end_sec: 45, note: "bass walks around" }, { start_sec: 80 }],
    });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent!.created).toBe(true);
    entryId = r.structuredContent!.entry.id;
    const hs = r.structuredContent!.highlights as { id: string; status: string }[];
    expect(hs.map((h) => h.status)).toEqual(["needs_tags", "needs_why"]);
    hlId = hs[0].id;
    const got = await call("get_entry", { entry_id: entryId });
    expect(got.content[0].text).toContain("Imaginary Band, Guest - Made Up Tune");
    expect(got.structuredContent!.entry.entry.album).toBe("Pretend");
  });

  it("add_entry on a saved link adds highlights to the existing entry", async () => {
    const r = await call("add_entry", { url: yt("AAAAAAAAAAA"), title: "Different Title", highlights: [{ note: "again" }] });
    expect(r.structuredContent!.created).toBe(false);
    expect(r.structuredContent!.entry.id).toBe(entryId);
    expect(r.structuredContent!.entry.title).toBe("Made Up Tune");
    expect(r.content[0].text).toContain("Ignored");
    const none = await call("add_entry", { url: yt("AAAAAAAAAAA") });
    expect(none.structuredContent!.highlights).toHaveLength(0);
  });

  it("add_entry with no highlights makes one whole-song needs_why highlight", async () => {
    const r = await call("add_entry", { url: yt("BBBBBBBBBBB"), title: "Solo" });
    expect(r.structuredContent!.highlights).toHaveLength(1);
    expect(r.structuredContent!.highlights[0]).toMatchObject({ status: "needs_why", startSec: null });
  });

  it("add_entry refuses bad links, bad times, and an unreadable title without inventing one", async () => {
    expect((await call("add_entry", { url: "https://example.com/x", title: "x" })).isError).toBe(true);
    expect((await call("add_entry", { url: yt("CCCCCCCCCCC"), title: "x", highlights: [{ start_sec: 50, end_sec: 10 }] })).isError).toBe(true);
    expect((await call("add_entry", { url: yt("CCCCCCCCCCC"), title: "x", highlights: [{ end_sec: 10 }] })).isError).toBe(true);
    // nothing was saved by the failed calls
    expect((await call("get_entry", { url: yt("CCCCCCCCCCC") })).isError).toBe(true);
  });

  it("add_entry always asks YouTube: a missing video is refused even with a title, raw metadata is stored", async () => {
    const gone = await call("add_entry", { url: yt("MISSINGxxx1"), title: "Ghost Song" });
    expect(gone.isError).toBe(true);
    expect((await call("get_entry", { url: yt("MISSINGxxx1") })).isError).toBe(true);
    const ok = await call("add_entry", { url: yt("OEMBEDxxxx1"), title: "Clean Title" });
    expect(ok.isError).toBeUndefined();
    const [src] = await db.select().from(entrySources).where(eq(entrySources.externalId, "OEMBEDxxxx1"));
    expect(src.rawTitle).toBe("OEMBEDxxxx1 Raw Title (Official Video)");
    expect(src.rawAuthor).toBe("Raw Channel");
    expect(ok.structuredContent!.entry.title).toBe("Clean Title");
    // not embeddable: the agent's title is still usable, without raw metadata; with no title it is refused
    const priv = await call("add_entry", { url: yt("PRIVATExxx1"), title: "Private Song" });
    expect(priv.isError).toBeUndefined();
    const [psrc] = await db.select().from(entrySources).where(eq(entrySources.externalId, "PRIVATExxx1"));
    expect(psrc.rawTitle).toBeNull();
    expect((await call("add_entry", { url: yt("PRIVATExxx2") })).isError).toBe(true);
  });

  it("add_entry: 401/403 keep the agent title; 404 and every unverifiable result (5xx, network error) are refused", async () => {
    const forbid = await call("add_entry", { url: yt("FORBIDxxxx1"), title: "Embedding Off" });
    expect(forbid.isError).toBeUndefined();
    for (const id of ["SERVERRxxx1", "NETDOWNxxx1"]) {
      const r = await call("add_entry", { url: yt(id), title: "Has A Title" });
      expect(r.isError, id).toBe(true);
      expect(r.content[0].text, id).toMatch(/couldn't verify the video with YouTube, try again later/i);
      expect((await call("get_entry", { url: yt(id) })).isError, id).toBe(true);
    }
  });

  it("add_entry gives oEmbed an abort signal, and skips oEmbed for a link that is already saved", async () => {
    seenSignals.length = 0;
    await call("add_entry", { url: yt("SIGNALxxxx1"), title: "Signal Song" });
    expect(seenSignals).toHaveLength(1);
    expect(seenSignals[0]).toBeInstanceOf(AbortSignal);
    await call("add_entry", { url: yt("SIGNALxxxx1"), highlights: [{ note: "again" }] });
    expect(seenSignals).toHaveLength(1);
  });

  it("add_entry matches artists by normalized name (accents, punctuation, leading The) and only those without an MBID", async () => {
    await call("add_entry", { url: yt("ARTISTxxx01"), title: "One", artists: ["The Sigur Rós"] });
    const r = await call("add_entry", { url: yt("ARTISTxxx02"), title: "Two", artists: ["sigur ros!"] });
    expect(r.isError).toBeUndefined();
    const rows = await db.select().from(artists).where(eq(artists.nameNormalized, "sigur ros"));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("The Sigur Rós");
    // an artist that already has an MBID is not reused by name
    await db.update(artists).set({ mbid: "11111111-1111-4111-8111-111111111111" }).where(eq(artists.id, rows[0].id));
    await call("add_entry", { url: yt("ARTISTxxx03"), title: "Three", artists: ["Sigur Ros"] });
    expect(await db.select().from(artists).where(eq(artists.nameNormalized, "sigur ros"))).toHaveLength(2);
  });

  it("set_highlight_tags records the connected app's name, and refuses status-like tag names", async () => {
    const r = await call("add_entry", { url: yt("TAGAGENTxx1"), title: "Tag Me", highlights: [{ note: "warm pad" }] });
    const id = r.structuredContent!.highlights[0].id as string;
    const set = await call("set_highlight_tags", { highlight_id: id, tags: [{ name: "warm pad", axis: "sound" }] });
    expect(set.isError).toBeUndefined();
    const rows = await db.select().from(highlightTags).where(eq(highlightTags.highlightId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0].agentName).toBe("Test Agent");
    for (const name of ["needs_why", "needs why", "needs-tags", "tagged"]) {
      const bad = await call("set_highlight_tags", { highlight_id: id, tags: [{ name, axis: "sound" }] });
      expect(bad.isError, name).toBe(true);
      expect(bad.content[0].text).toContain("not a tag");
    }
    expect((await db.select().from(highlightTags).where(eq(highlightTags.highlightId, id)))).toHaveLength(1);
  });

  it("add_highlight and update_highlight follow the status rules", async () => {
    const added = await call("add_highlight", { entry_id: entryId, start_sec: 120, note: "outro" });
    const id = added.structuredContent!.highlight.id as string;
    expect(added.structuredContent!.highlight.status).toBe("needs_tags");
    await call("set_highlight_tags", { highlight_id: id, tags: [{ name: "outro swell", axis: "structure" }] });
    const timesOnly = await call("update_highlight", { highlight_id: id, start_sec: 121 });
    expect(timesOnly.structuredContent!.highlight).toMatchObject({ status: "tagged", startSec: 121, note: "outro" });
    const edited = await call("update_highlight", { highlight_id: id, note: "a different outro note" });
    expect(edited.structuredContent!.highlight.status).toBe("needs_tags");
    const cleared = await call("update_highlight", { highlight_id: id, note: null });
    expect(cleared.structuredContent!.highlight).toMatchObject({ status: "needs_why", note: null });
    expect((await call("update_highlight", { highlight_id: id })).isError).toBe(true);
    expect((await call("update_highlight", { highlight_id: id, end_sec: 5, start_sec: 9 })).isError).toBe(true);
  });

  it("set_highlight_tags diffs, proposes new tags, and refuses needs_why", async () => {
    const first = await call("set_highlight_tags", {
      highlight_id: hlId,
      tags: [{ name: "Walking Bass", axis: "technique" }, { name: "warm", axis: "sound" }],
    });
    expect(first.isError).toBeUndefined();
    expect(first.structuredContent!.created.map((c: { state: string }) => c.state)).toEqual(["proposed", "proposed"]);
    expect(first.structuredContent!.highlight.status).toBe("tagged");
    const second = await call("set_highlight_tags", { highlight_id: hlId, tags: [{ name: "walking bass", axis: "technique" }] });
    expect(second.structuredContent!.added).toHaveLength(0);
    expect(second.structuredContent!.removedTagIds).toHaveLength(1);
    const noNote = (await call("get_entry", { entry_id: entryId })).structuredContent!.entry.highlights.find(
      (h: { status: string }) => h.status === "needs_why",
    );
    const refused = await call("set_highlight_tags", { highlight_id: noNote.id, tags: [{ name: "warm", axis: "sound" }] });
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain("no note");
    expect((await call("set_highlight_tags", { highlight_id: hlId, tags: [{ name: "Bad, Name!", axis: "sound" }] })).isError).toBe(true);
    expect((await call("set_highlight_tags", { highlight_id: hlId, tags: [{ name: "fine", axis: "nope" }] })).isError).toBe(true);
  });

  it("changes are refused, naming the switch, when allowChanges is off", async () => {
    await t.db.update(settings).set({ mcpAllowChanges: false }).where(eq(settings.userId, OWNER_USER_ID));
    const calls: [string, Record<string, unknown>][] = [
      ["add_entry", { url: yt("DDDDDDDDDDD"), title: "x" }],
      ["add_highlight", { entry_id: entryId }],
      ["update_highlight", { highlight_id: hlId, note: "x" }],
      ["set_highlight_tags", { highlight_id: hlId, tags: [] }],
      ["restore_deleted", { entry_id: entryId }],
    ];
    for (const [name, args] of calls) {
      const r = await call(name, args);
      expect(r.isError, name).toBe(true);
      expect(r.content[0].text, name).toContain("Allow changes");
    }
    expect((await call("get_entry", { url: yt("DDDDDDDDDDD") })).isError).toBe(true);
    await t.db.update(settings).set({ mcpAllowChanges: true }).where(eq(settings.userId, OWNER_USER_ID));
  });

  it("delete and restore: last highlight guard, confirm, entry restore with conflict", async () => {
    const solo = await call("add_entry", { url: yt("EEEEEEEEEEE"), title: "Deletable", highlights: [{ note: "one" }, { note: "two" }] });
    const soloId = solo.structuredContent!.entry.id as string;
    const [h1, h2] = solo.structuredContent!.highlights as { id: string }[];
    const del = await call("delete_highlight", { highlight_id: h1.id });
    expect(del.isError).toBeUndefined();
    const last = await call("delete_highlight", { highlight_id: h2.id });
    expect(last.isError).toBe(true);
    expect(last.content[0].text).toContain("Delete the entry instead");
    const back = await call("restore_deleted", { highlight_id: h1.id });
    expect(back.structuredContent!.restored.highlight.id).toBe(h1.id);

    // confirm must be true (rejected by the input schema)
    const res = await handleMcp(rpc("tools/call", { name: "delete_entry", arguments: { entry_id: soloId, confirm: false } }), db, ENV);
    const body = (await res.json()) as { result?: { isError?: boolean }; error?: unknown };
    expect(body.result?.isError === true || body.error !== undefined).toBe(true);
    expect((await call("get_entry", { entry_id: soloId })).isError).toBeUndefined();

    expect((await call("delete_entry", { entry_id: soloId, confirm: true })).isError).toBeUndefined();
    expect((await call("get_entry", { entry_id: soloId })).isError).toBe(true);
    const hl = await call("restore_deleted", { highlight_id: h2.id });
    expect(hl.isError).toBe(true);
    expect(hl.content[0].text).toContain("Restore the entry");
    // saved again meanwhile -> restoring the old entry reports the conflict
    await call("add_entry", { url: yt("EEEEEEEEEEE"), title: "Deletable again" });
    const conflict = await call("restore_deleted", { entry_id: soloId });
    expect(conflict.isError).toBe(true);
    expect(conflict.content[0].text).toContain("Deletable again");
    expect((await call("restore_deleted", {})).isError).toBe(true);
    expect((await call("restore_deleted", { entry_id: soloId, highlight_id: h1.id })).isError).toBe(true);
  });

  it("delete tools are refused, naming the switch, when allowDeletes is off", async () => {
    await t.db.update(settings).set({ mcpAllowDeletes: false }).where(eq(settings.userId, OWNER_USER_ID));
    const a = await call("delete_highlight", { highlight_id: hlId });
    const b = await call("delete_entry", { entry_id: entryId, confirm: true });
    for (const r of [a, b]) {
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("Allow deletes");
    }
    expect((await call("get_entry", { entry_id: entryId })).isError).toBeUndefined();
    // restoring needs only allowChanges
    const gone = await call("add_entry", { url: yt("FFFFFFFFFFF"), title: "Brief" });
    await t.db.update(settings).set({ mcpAllowDeletes: true }).where(eq(settings.userId, OWNER_USER_ID));
    await call("delete_entry", { entry_id: gone.structuredContent!.entry.id, confirm: true });
    await t.db.update(settings).set({ mcpAllowDeletes: false }).where(eq(settings.userId, OWNER_USER_ID));
    expect((await call("restore_deleted", { entry_id: gone.structuredContent!.entry.id })).isError).toBeUndefined();
    await t.db.update(settings).set({ mcpAllowDeletes: true }).where(eq(settings.userId, OWNER_USER_ID));
  });

  it("delete tools also need allowChanges", async () => {
    await t.db.update(settings).set({ mcpAllowChanges: false }).where(eq(settings.userId, OWNER_USER_ID));
    const a = await call("delete_highlight", { highlight_id: hlId });
    const b = await call("delete_entry", { entry_id: entryId, confirm: true });
    for (const r of [a, b]) {
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("Allow changes");
    }
    await t.db.update(settings).set({ mcpAllowChanges: true }).where(eq(settings.userId, OWNER_USER_ID));
    expect((await call("get_entry", { entry_id: entryId })).isError).toBeUndefined();
  });

  it("unexpected failures return a generic message and are logged, never raw SQL", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tx = vi.spyOn(db, "transaction").mockRejectedValueOnce(new Error('insert into "highlights" failed: secret detail'));
    const r = await call("add_highlight", { entry_id: entryId });
    tx.mockRestore();
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("Something went wrong on the server; try again.");
    expect(JSON.stringify(r)).not.toContain("secret detail");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("a database error while reading the connector switches is generic too", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const realSelect = db.select.bind(db) as (...a: unknown[]) => any;
    const sel = vi.spyOn(db, "select").mockImplementation(((...a: unknown[]) => {
      const b = realSelect(...a);
      const from = b.from.bind(b);
      b.from = (table: unknown) => {
        if (table === settings) throw new Error('select "mcp_enabled" from "settings" failed: secret detail');
        return from(table);
      };
      return b;
    }) as any);
    const r = await call("list_inbox");
    sel.mockRestore();
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("Something went wrong on the server; try again.");
    expect(JSON.stringify(r)).not.toContain("secret detail");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("add_entry is atomic: a failing later step leaves nothing saved, and a retry works", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const realTransaction = (db as any).transaction.bind(db);
    // Fail the artist link, the last step, after the entry and highlights were written in the transaction.
    const ins = vi.spyOn(db as any, "transaction").mockImplementation(((fn: (tx: any) => Promise<unknown>) =>
      realTransaction((tx: any) =>
        fn(
          new Proxy(tx, {
            get(target, prop) {
              if (prop === "insert") {
                return (table: unknown) => {
                  if (table === entryArtists) throw new Error("boom: secret detail");
                  return target.insert(table);
                };
              }
              const v = Reflect.get(target, prop, target);
              return typeof v === "function" ? v.bind(target) : v;
            },
          }),
        ),
      )) as any);
    const url = yt("ATOMICxxxx1");
    const r = await call("add_entry", { url, title: "Atomic Song", artists: ["Atomic Band"], highlights: [{ note: "a" }, { note: "b" }] });
    ins.mockRestore();
    spy.mockRestore();
    expect(r.isError).toBe(true);
    expect((await call("get_entry", { url })).isError).toBe(true);
    const rows = await db.select().from(entrySources).where(eq(entrySources.externalId, "ATOMICxxxx1"));
    expect(rows).toHaveLength(0);
    const retry = await call("add_entry", { url, title: "Atomic Song", artists: ["Atomic Band"], highlights: [{ note: "a" }, { note: "b" }] });
    expect(retry.isError).toBeUndefined();
    expect(retry.structuredContent!.created).toBe(true);
    expect(retry.structuredContent!.highlights).toHaveLength(2);
  });
});

describe("search dates use settings.time_zone", () => {
  it("an evening-Toronto capture belongs to that Toronto day, not the UTC day", async () => {
    const e = await addEntry(db, OWNER_USER_ID, {
      title: "Evening",
      source: { type: "youtube", externalId: "evening0001", url: yt("evening0001") },
      highlight: { note: "captured at night" },
    });
    if (e.duplicate) throw new Error("dup");
    // 2026-03-10 02:30 UTC is 2026-03-09 22:30 in Toronto (EDT).
    await t.db.update(highlights).set({ capturedAt: new Date("2026-03-10T02:30:00Z") }).where(eq(highlights.id, e.highlight.id));
    const ids = async (a: Record<string, unknown>) =>
      ((await call("search_highlights", { query: "captured at night", ...a })).structuredContent!.highlights as { id: string }[]).map((h) => h.id);
    expect(await ids({ from: "2026-03-09", to: "2026-03-10" })).toEqual([e.highlight.id]);
    expect(await ids({ from: "2026-03-10" })).toEqual([]);
    expect(await ids({ to: "2026-03-09" })).toEqual([]);
    expect(await ids({ from: "2026-03-09" })).toEqual([e.highlight.id]);
  });

  it("rejects dates that are not on the calendar", async () => {
    for (const d of ["2026-02-30", "2026-13-01", "2026-04-31", "2025-02-29"]) {
      const r = await call("search_highlights", { from: d });
      expect(r.isError, d).toBe(true);
      expect(r.content[0].text).toContain("real calendar date");
    }
    expect((await call("search_highlights", { to: "2024-02-29" })).isError).toBeUndefined();
    expect((await call("search_highlights", { from: "2026-3-1" })).isError).toBe(true);
  });
});

describe("list_entries cursor bounds", () => {
  it("rejects offsets that are unsafe or absurdly large", async () => {
    for (const cursor of ["1000001", "9007199254740993", "-1", "abc", "1.5"]) {
      await expect(listEntriesForAgent(db, OWNER_USER_ID, { cursor }), cursor).rejects.toThrow("Invalid cursor");
    }
    await expect(listEntriesForAgent(db, OWNER_USER_ID, { cursor: "1000000" })).resolves.toMatchObject({ items: [] });
  });
});

describe("cross-user isolation", () => {
  const ids = (r: { structuredContent?: Record<string, any> }, key: string) =>
    JSON.stringify(r.structuredContent?.[key] ?? null);

  it("no read tool shows the other user's data", async () => {
    const forbidden = [otherEntryId, otherHighlightId, otherDeletedHighlightId, otherDeletedEntryId, otherTagId, "zebra", "Zebra", "Other Persons Song"];
    const results = [
      await call("list_inbox", { limit: 200 }),
      await call("get_taxonomy"),
      await call("search_highlights", { limit: 100 }),
      await call("search_highlights", { query: "zebra" }),
      await call("search_highlights", { tags: ["zebra tag"] }),
      await call("search_highlights", { axis: "sound", limit: 100 }),
      await call("search_highlights", { artist: "Zebra Band" }),
      await call("list_entries", { limit: 100 }),
      await call("list_entries", { artist: "Zebra Band" }),
    ];
    for (const r of results) {
      const blob = JSON.stringify(r);
      for (const f of forbidden) expect(blob).not.toContain(f);
    }
    expect(ids(results[3], "highlights")).toBe("[]");
    expect(ids(results[4], "highlights")).toBe("[]");
    expect(ids(results[6], "highlights")).toBe("[]");
    expect(ids(results[8], "entries")).toBe("[]");
  });

  it("get_entry by id and by URL does not find the other user's entry", async () => {
    expect((await call("get_entry", { entry_id: otherEntryId })).isError).toBe(true);
    expect((await call("get_entry", { entry_id: otherDeletedEntryId })).isError).toBe(true);
    expect((await call("get_entry", { url: yt("otheruser01") })).isError).toBe(true);
  });

  it("no write or delete tool can touch the other user's data", async () => {
    const attempts: [string, Record<string, unknown>][] = [
      ["add_highlight", { entry_id: otherEntryId, note: "intruder" }],
      ["update_highlight", { highlight_id: otherHighlightId, note: "intruder" }],
      ["set_highlight_tags", { highlight_id: otherHighlightId, tags: [{ name: "intruder", axis: "sound" }] }],
      ["delete_highlight", { highlight_id: otherHighlightId }],
      ["delete_entry", { entry_id: otherEntryId, confirm: true }],
      ["restore_deleted", { entry_id: otherDeletedEntryId }],
      ["restore_deleted", { highlight_id: otherDeletedHighlightId }],
    ];
    for (const [name, args] of attempts) {
      const r = await call(name, args);
      expect(r.isError, name).toBe(true);
      expect(r.content[0].text, name).toMatch(/not found/i);
    }
    // add_entry on the other user's link creates the owner's own separate entry
    const mine = await call("add_entry", { url: yt("otheruser01"), title: "Mine" });
    expect(mine.structuredContent!.created).toBe(true);
    expect(mine.structuredContent!.entry.id).not.toBe(otherEntryId);


    const theirs = await t.db.select().from(highlights).where(eq(highlights.id, otherHighlightId));
    expect(theirs[0]).toMatchObject({ note: "secret zebra note", status: "tagged", deletedAt: null });
    const deletedBack = await t.db.select().from(highlights).where(eq(highlights.id, otherDeletedHighlightId));
    expect(deletedBack[0].deletedAt).not.toBeNull();
    const tagCount = await t.client.query("select count(*)::int as n from highlight_tags where highlight_id = $1", [otherHighlightId]);
    expect((tagCount.rows[0] as { n: number }).n).toBe(1);
    const intruderTags = await t.client.query("select count(*)::int as n from tags where name = 'intruder'");
    expect((intruderTags.rows[0] as { n: number }).n).toBe(0);
  });
});

describe("match_entry", () => {
  const REC = "11111111-1111-4111-8111-111111111111";
  const mbFetch = async (url: string) => {
    const body = url.includes("/recording/")
      ? { id: REC, title: "Made Up Song", "first-release-date": "1986-03-01", "artist-credit": [{ name: "Made Up Band", artist: { id: "22222222-2222-4222-8222-222222222222", name: "Made Up Band" } }], releases: [] }
      : { genres: [{ name: "post-punk", count: 3 }] };
    return { ok: true, status: 200, json: async () => body };
  };
  const mb = { fetch: mbFetch, contact: "x@example.test", minIntervalMs: 0 };
  const callMb = async (args: Record<string, unknown>) => {
    const res = await handleMcp(rpc("tools/call", { name: "match_entry", arguments: args }), db, ENV, {}, mb);
    return ((await res.json()) as { result: { content: { text: string }[]; structuredContent?: Record<string, any>; isError?: boolean } }).result;
  };

  it("matches an entry at high confidence and stores a candidate at low", async () => {
    const lo = await insertEntry(t.db, { title: "Raw Title" });
    const r1 = await callMb({ entry_id: lo.id, mbid: REC, confidence: "low" });
    expect(r1.isError).toBeFalsy();
    expect(r1.structuredContent!.outcome).toBe("candidate");
    expect(r1.structuredContent!.entry).toMatchObject({ matchStatus: "unmatched", mbidCandidate: REC, title: "Raw Title" });

    const hi = await insertEntry(t.db, { title: "Raw Title 2" });
    const r2 = await callMb({ entry_id: hi.id, mbid: REC, confidence: "high" });
    expect(r2.structuredContent!.entry).toMatchObject({ matchStatus: "matched", mbid: REC, title: "Made Up Song", originalReleaseYear: 1986 });
  });

  it("refuses another user's entry and a malformed id", async () => {
    const r = await callMb({ entry_id: otherEntryId, mbid: REC, confidence: "high" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/not found/i);
    const bad = await callMb({ entry_id: otherEntryId, mbid: "nope", confidence: "high" });
    expect(bad.isError).toBe(true);
  });
});
