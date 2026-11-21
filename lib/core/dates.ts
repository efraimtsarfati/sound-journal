import { CoreError } from "./errors";

export const DEFAULT_TIME_ZONE = "America/Toronto";

/** True when the runtime knows `timeZone` (an IANA name such as America/Toronto). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Throws a readable `invalid_state` error when the stored `settings.time_zone` is not a real zone. */
export function assertTimeZone(timeZone: string): void {
  if (!isValidTimeZone(timeZone)) {
    throw new CoreError("invalid_state", `The time zone in settings ("${timeZone}") is not a valid IANA zone name; the owner needs to correct it.`);
  }
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

const DAY_MS = 24 * 3600 * 1000;

/**
 * The instant at which the calendar day `ymd` (YYYY-MM-DD) starts in `timeZone`: the first instant
 * whose local date is `ymd`. Rejects text that is not a real calendar date (for example 2026-02-30).
 * Handles zones whose clock skips midnight (America/Santiago springs forward 00:00 -> 01:00, so the
 * day starts at the jump) and ones that repeat it (the earlier midnight wins).
 */
export function startOfDayInZone(ymd: string, timeZone: string, label = "date"): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  const bad = () => new CoreError("invalid_input", `${label} must be a real calendar date written YYYY-MM-DD.`);
  if (!m) throw bad();
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) throw bad();
  assertTimeZone(timeZone);
  // The offsets in force around that day; an instant is local midnight when its own offset is the one used to reach it.
  const before = zoneOffsetMs(probe.getTime() - DAY_MS, timeZone);
  const after = zoneOffsetMs(probe.getTime() + DAY_MS, timeZone);
  const hits = [before, after]
    .map((o) => ({ o, at: probe.getTime() - o }))
    .filter(({ o, at }) => zoneOffsetMs(at, timeZone) === o)
    .map(({ at }) => at);
  // No hit means midnight does not exist that day (the clock jumped over it): the day starts at the jump.
  return new Date(hits.length ? Math.min(...hits) : probe.getTime() - before);
}

/** "2026-11-21 14:05 EST"-style text for `d` in `timeZone`; an invalid zone falls back to UTC. */
export function formatInZone(d: Date, timeZone: string): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} ${get("timeZoneName")}`;
}
