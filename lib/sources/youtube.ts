/**
 * YouTube source adapter (docs/architecture.md -> Key flows -> Save from the web app).
 * Pure parsing and title derivation, plus an oEmbed fetch with an injectable `fetch`.
 * No API key. Nothing here touches the database.
 */

export const YOUTUBE_SOURCE_TYPE = "youtube";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be"]);
/** Path prefixes that carry the video ID as the next segment. */
const ID_PREFIXES = new Set(["embed", "shorts", "live", "v"]);

export interface ParsedYouTubeUrl {
  videoId: string;
  /** Whole seconds from `t=` / `start=` (or a `#t=` fragment); null when the link has none. */
  startSec: number | null;
}

/** Parses `90`, `90s`, `1m30s`, `1h2m3s`. Returns null for anything else (never guesses). */
export function parseTimeParam(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const v = raw.trim().toLowerCase();
  if (v === "") return null;
  if (/^\d+(\.\d+)?s?$/.test(v)) return Math.floor(parseFloat(v));
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v);
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** Returns the video ID and any start time, or null if the input is not a recognised YouTube video link. */
export function parseYouTubeUrl(input: string): ParsedYouTubeUrl | null {
  let url: URL;
  try {
    const trimmed = input.trim();
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  let videoId: string | null = null;
  if (host.endsWith("youtu.be")) {
    videoId = segments[0] ?? null;
  } else if (segments[0] === "watch") {
    videoId = url.searchParams.get("v");
  } else if (segments.length >= 2 && ID_PREFIXES.has(segments[0])) {
    videoId = segments[1];
  }
  if (!videoId || !VIDEO_ID.test(videoId)) return null;

  let startSec = parseTimeParam(url.searchParams.get("t")) ?? parseTimeParam(url.searchParams.get("start"));
  if (startSec === null && url.hash) {
    const frag = /^#t=(.+)$/.exec(url.hash);
    if (frag) startSec = parseTimeParam(frag[1]);
  }
  return { videoId, startSec };
}

/** The canonical URL stored as the source URL, and the link-out used when a video can't be embedded. */
export function youtubeWatchUrl(videoId: string, startSec?: number | null): string {
  const base = `https://www.youtube.com/watch?v=${videoId}`;
  return startSec ? `${base}&t=${Math.floor(startSec)}s` : base;
}

export type YouTubeErrorCode = "not_found" | "not_embeddable" | "unavailable";

export class YouTubeError extends Error {
  constructor(
    public readonly code: YouTubeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "YouTubeError";
  }
}

export interface OEmbedResult {
  /** Raw YouTube title, kept in `entry_sources.raw_title`. */
  rawTitle: string;
  /** Raw channel name, kept in `entry_sources.raw_author`. */
  rawChannel: string;
}

type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/**
 * Fetches title and channel from YouTube's public oEmbed endpoint.
 * 404 -> not_found (no such video); 401/403 -> not_embeddable (private, or embedding disabled:
 * the caller falls back to a link-out with typed timestamps); anything else -> unavailable.
 */
export async function fetchOEmbed(
  videoId: string,
  opts: { fetch?: FetchLike; signal?: AbortSignal } = {},
): Promise<OEmbedResult> {
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  const endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(youtubeWatchUrl(videoId))}`;
  let res;
  try {
    res = await doFetch(endpoint, { signal: opts.signal });
  } catch {
    throw new YouTubeError("unavailable", "Could not reach YouTube.");
  }
  if (res.status === 404) throw new YouTubeError("not_found", "No YouTube video with that ID.");
  if (res.status === 401 || res.status === 403) {
    throw new YouTubeError("not_embeddable", "This video is private or can't be embedded.");
  }
  if (!res.ok) throw new YouTubeError("unavailable", `YouTube returned ${res.status}.`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new YouTubeError("unavailable", "YouTube returned an unreadable response.");
  }
  const b = body as { title?: unknown; author_name?: unknown } | null;
  if (!b || typeof b.title !== "string" || b.title.trim() === "") {
    throw new YouTubeError("unavailable", "YouTube returned no title.");
  }
  return { rawTitle: b.title, rawChannel: typeof b.author_name === "string" ? b.author_name : "" };
}

// ---- title / artist derivation ----------------------------------------------------------------

const NOISE_WORDS =
  /^(official(\s+(music\s+)?(audio|video|lyric\s+video|visualizer))?|(music|lyric|lyrics|audio|visualizer|hd|hq|4k|full)(\s+(video|version|audio))?|lyrics?|remaster(ed)?(\s+\d{4})?|(\d{4}|4k|hd)\s+remaster(ed)?(\s+version)?|remastered\s+version|(\d{4})|hd|hq|4k|1080p|with\s+lyrics)$/i;

/** Removes trailing/inline bracketed noise like "(Official Video)", "[Remastered 2015]", "(1986)". */
function stripBracketNoise(s: string): string {
  return s.replace(/\s*[([]([^()[\]]*)[)\]]/g, (whole, inner: string) =>
    NOISE_WORDS.test(inner.trim()) ? "" : whole,
  );
}

/** Removes an unbracketed trailing suffix such as " - Remastered 2015" or " | Official Audio". */
function stripTrailingSuffix(s: string): string {
  return s.replace(
    /\s+[-–—|]\s+(official(\s+(music\s+)?(audio|video|lyric\s+video))?|lyrics?(\s+video)?|(\d{4}\s+)?remaster(ed)?(\s+(version|\d{4}))?)\s*$/i,
    "",
  );
}

function cleanSegment(s: string): string {
  return stripTrailingSuffix(stripBracketNoise(s)).replace(/\s{2,}/g, " ").trim();
}

export interface DerivedTitle {
  title: string;
  artist: string | null;
}

/**
 * Initial title and artist from the raw YouTube title and channel. Best effort only: the entry stays
 * `unmatched` and the agent or M7 matching supplies clean values. Never invents an artist: an ordinary
 * channel name is not treated as one; only "<Artist> - Topic" channels are.
 */
export function deriveTitleArtist(rawTitle: string, rawChannel: string): DerivedTitle {
  const topic = /^(.*\S)\s+-\s+Topic$/i.exec(rawChannel.trim());
  const topicArtist = topic ? topic[1].trim() : null;

  const cleaned = cleanSegment(rawTitle);
  const split = /^(.+?)\s+[-–—]\s+(.+)$/.exec(cleaned);

  let artist: string | null = null;
  let title = cleaned;
  if (split) {
    const left = split[1].trim();
    const right = cleanSegment(split[2]);
    if (topicArtist) {
      // The channel is authoritative; only drop the title prefix when it repeats the artist.
      if (left.toLowerCase() === topicArtist.toLowerCase() && right) title = right;
    } else if (right) {
      artist = left;
      title = right;
    }
  }
  if (topicArtist) artist = topicArtist;
  if (!title) title = rawTitle.trim();
  return { title, artist };
}
