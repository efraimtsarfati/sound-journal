import type { Db } from "../db";
import { findDuplicateEntry } from "./entries";
import {
  YOUTUBE_SOURCE_TYPE,
  YouTubeError,
  deriveTitleArtist,
  fetchOEmbed,
  parseYouTubeUrl,
  youtubeWatchUrl,
} from "../sources/youtube";

export type LookupResult =
  | { ok: false; error: "invalid_url" | "not_found" | "unavailable"; message: string }
  | {
      ok: true;
      videoId: string;
      startSec: number | null;
      watchUrl: string;
      /** False when oEmbed refused (private or embedding disabled): link out, type times, type the title. */
      embeddable: boolean;
      rawTitle: string | null;
      rawChannel: string | null;
      title: string;
      artist: string | null;
      duplicate: { id: string; title: string } | null;
    };

/** Capture step 1: parse the pasted link, fetch oEmbed, derive title/artist, check for a duplicate. */
export async function lookupYouTube(
  db: Db,
  userId: string,
  url: string,
  opts: NonNullable<Parameters<typeof fetchOEmbed>[1]> = {},
): Promise<LookupResult> {
  const parsed = parseYouTubeUrl(url);
  if (!parsed) return { ok: false, error: "invalid_url", message: "That doesn't look like a YouTube link." };

  let rawTitle: string | null = null;
  let rawChannel: string | null = null;
  let embeddable = true;
  try {
    const o = await fetchOEmbed(parsed.videoId, opts);
    rawTitle = o.rawTitle;
    rawChannel = o.rawChannel;
  } catch (e) {
    if (!(e instanceof YouTubeError)) throw e;
    if (e.code === "not_found") return { ok: false, error: "not_found", message: e.message };
    if (e.code === "unavailable") return { ok: false, error: "unavailable", message: e.message };
    embeddable = false;
  }

  const derived = rawTitle !== null ? deriveTitleArtist(rawTitle, rawChannel ?? "") : { title: "", artist: null };
  const dup = await findDuplicateEntry(db, userId, YOUTUBE_SOURCE_TYPE, parsed.videoId);
  return {
    ok: true,
    videoId: parsed.videoId,
    startSec: parsed.startSec,
    watchUrl: youtubeWatchUrl(parsed.videoId, parsed.startSec),
    embeddable,
    rawTitle,
    rawChannel,
    title: derived.title,
    artist: derived.artist,
    duplicate: dup ? { id: dup.id, title: dup.title } : null,
  };
}
