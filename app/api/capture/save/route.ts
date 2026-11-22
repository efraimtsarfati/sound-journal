import { z } from "zod";
import { CoreError, OWNER_USER_ID, addEntry, addHighlight } from "@/lib/core";
import { getDb } from "@/lib/db";
import { syncSearchAfterResponse } from "@/lib/http/search-after";
import { YOUTUBE_SOURCE_TYPE, parseYouTubeUrl, youtubeWatchUrl } from "@/lib/sources/youtube";

const Body = z.object({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  title: z.string().max(500),
  rawTitle: z.string().max(500).nullable(),
  rawChannel: z.string().max(500).nullable(),
  startSec: z.number().int().min(0).nullable(),
  endSec: z.number().int().min(1).nullable(),
  note: z.string().max(10000).nullable(),
  /** Set when the owner chose "add a highlight to the existing entry". */
  entryId: z.uuid().nullable(),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const b = parsed.data;
  const highlight = { startSec: b.startSec, endSec: b.endSec, note: b.note };
  const db = getDb();
  try {
    if (b.entryId) {
      const h = await addHighlight(db, OWNER_USER_ID, b.entryId, highlight);
      syncSearchAfterResponse();
      return Response.json({ ok: true, entryId: h.entryId, highlightId: h.id, status: h.status });
    }
    if (!parseYouTubeUrl(youtubeWatchUrl(b.videoId))) return Response.json({ error: "invalid_input" }, { status: 400 });
    const result = await addEntry(db, OWNER_USER_ID, {
      title: b.title,
      source: {
        type: YOUTUBE_SOURCE_TYPE,
        externalId: b.videoId,
        url: youtubeWatchUrl(b.videoId),
        rawTitle: b.rawTitle,
        rawAuthor: b.rawChannel,
      },
      highlight,
    });
    if (result.duplicate) {
      return Response.json(
        { error: "duplicate", entry: { id: result.duplicate.id, title: result.duplicate.title } },
        { status: 409 },
      );
    }
    syncSearchAfterResponse();
    return Response.json({
      ok: true,
      entryId: result.entry.id,
      highlightId: result.highlight.id,
      status: result.highlight.status,
    });
  } catch (e) {
    if (e instanceof CoreError) {
      const status = e.code === "not_found" ? 404 : 400;
      return Response.json({ error: e.code, message: e.message }, { status });
    }
    throw e;
  }
}
