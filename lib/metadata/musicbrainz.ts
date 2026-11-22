/**
 * MusicBrainz adapter (docs/architecture.md -> Metadata matching). Looks up one recording by ID and
 * an artist's genres. No API key; the one requirement is a descriptive User-Agent with contact info,
 * read from `MUSICBRAINZ_CONTACT`. Requests are spaced at least a second apart (their rate limit).
 * Nothing here touches the database. `fetch` and the clock are injectable for tests.
 */

const API = "https://musicbrainz.org/ws/2";
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MIN_INTERVAL_MS = 1100;

export type MusicBrainzErrorCode = "not_configured" | "invalid_id" | "not_found" | "unavailable";

export class MusicBrainzError extends Error {
  constructor(
    public readonly code: MusicBrainzErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MusicBrainzError";
  }
}

export type MbArtist = { mbid: string; name: string };
export type MbRecording = {
  mbid: string;
  title: string;
  /** Credited artists in order. */
  artists: MbArtist[];
  /** Title of the earliest release the recording appears on, or null. */
  album: string | null;
  /** Year of the recording's first release, or null. */
  year: number | null;
};
export type MbGenre = { genre: string; weight: number | null };

type FetchLike = (input: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export type MusicBrainzDeps = {
  fetch?: FetchLike;
  /** Contact for the User-Agent; defaults to `process.env.MUSICBRAINZ_CONTACT`. */
  contact?: string;
  /** Minimum gap between requests; tests pass 0. */
  minIntervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

// One in-process queue so concurrent calls still go out one second apart.
let queue: Promise<void> = Promise.resolve();
let lastAt = 0;

function throttled(minIntervalMs: number): Promise<void> {
  if (minIntervalMs <= 0) return Promise.resolve();
  const turn = queue.then(async () => {
    const wait = lastAt + minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
  });
  queue = turn.catch(() => undefined);
  return turn;
}

export function isMbid(s: string): boolean {
  return MBID.test(s);
}

async function getJson(path: string, deps: MusicBrainzDeps): Promise<unknown> {
  const contact = (deps.contact ?? process.env.MUSICBRAINZ_CONTACT ?? "").trim();
  if (contact === "") throw new MusicBrainzError("not_configured", "MusicBrainz lookups are not configured (MUSICBRAINZ_CONTACT is unset).");
  await throttled(deps.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS);
  const timeout = AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = deps.signal ? AbortSignal.any([deps.signal, timeout]) : timeout;
  const doFetch: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  let res;
  try {
    res = await doFetch(`${API}${path}${path.includes("?") ? "&" : "?"}fmt=json`, {
      signal,
      headers: { "User-Agent": `SoundJournal/1.0 ( ${contact} )`, Accept: "application/json" },
    });
  } catch {
    throw new MusicBrainzError("unavailable", "Could not reach MusicBrainz.");
  }
  if (res.status === 404) throw new MusicBrainzError("not_found", "MusicBrainz has no record with that ID.");
  if (!res.ok) throw new MusicBrainzError("unavailable", `MusicBrainz returned ${res.status}.`);
  try {
    return await res.json();
  } catch {
    throw new MusicBrainzError("unavailable", "MusicBrainz returned an unreadable response.");
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const yearOf = (v: unknown): number | null => {
  const m = typeof v === "string" ? /^(\d{4})/.exec(v) : null;
  return m ? Number(m[1]) : null;
};

/** Looks up one recording with its credited artists and earliest release. */
export async function lookupRecording(mbid: string, deps: MusicBrainzDeps = {}): Promise<MbRecording> {
  if (!isMbid(mbid)) throw new MusicBrainzError("invalid_id", "That is not a MusicBrainz ID (a UUID).");
  const id = mbid.toLowerCase();
  const body = (await getJson(`/recording/${id}?inc=artist-credits+releases`, deps)) as Record<string, unknown> | null;
  const title = str(body?.title);
  if (!body || str(body.id)?.toLowerCase() !== id || !title) {
    throw new MusicBrainzError("unavailable", "MusicBrainz returned an unexpected answer.");
  }
  const credits = Array.isArray(body["artist-credit"]) ? (body["artist-credit"] as Record<string, unknown>[]) : [];
  const seen = new Set<string>();
  const artists: MbArtist[] = [];
  for (const c of credits) {
    const a = c.artist as Record<string, unknown> | undefined;
    const aid = str(a?.id)?.toLowerCase();
    const name = str(a?.name) ?? str(c.name);
    if (!aid || !isMbid(aid) || !name || seen.has(aid)) continue;
    seen.add(aid);
    artists.push({ mbid: aid, name });
  }
  const releases = Array.isArray(body.releases) ? (body.releases as Record<string, unknown>[]) : [];
  const dated = releases
    .map((r) => ({ title: str(r.title), date: str(r.date) ?? "" }))
    .filter((r) => r.title)
    .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  return {
    mbid: id,
    title,
    artists,
    album: dated[0]?.title ?? null,
    year: yearOf(body["first-release-date"]) ?? yearOf(dated.find((r) => r.date)?.date),
  };
}

/** An artist's genres as MusicBrainz lists them (weight is the vote count). */
export async function lookupArtistGenres(mbid: string, deps: MusicBrainzDeps = {}): Promise<MbGenre[]> {
  if (!isMbid(mbid)) throw new MusicBrainzError("invalid_id", "That is not a MusicBrainz ID (a UUID).");
  const body = (await getJson(`/artist/${mbid.toLowerCase()}?inc=genres`, deps)) as { genres?: unknown } | null;
  const list = Array.isArray(body?.genres) ? (body.genres as Record<string, unknown>[]) : [];
  const out = new Map<string, MbGenre>();
  for (const g of list) {
    const name = str(g.name)?.toLowerCase();
    if (!name) continue;
    out.set(name, { genre: name, weight: typeof g.count === "number" ? g.count : null });
  }
  return [...out.values()];
}
