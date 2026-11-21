import { CoreError } from "./errors";

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

/**
 * The instant at which the calendar day `ymd` (YYYY-MM-DD) starts in `timeZone`.
 * Rejects text that is not a real calendar date (for example 2026-02-30).
 */
export function startOfDayInZone(ymd: string, timeZone: string, label = "date"): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  const bad = () => new CoreError("invalid_input", `${label} must be a real calendar date written YYYY-MM-DD.`);
  if (!m) throw bad();
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) throw bad();
  // Settle on the offset in force at local midnight (two passes handle a DST change that day).
  let instant = probe.getTime();
  for (let i = 0; i < 2; i++) instant = probe.getTime() - zoneOffsetMs(instant, timeZone);
  return new Date(instant);
}
