/** "1:05" for 65, "1:02:03" for 3723. Whole seconds only. */
export function formatTime(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/**
 * Parses typed times: "75", "1:15", "1:02:03". Returns null for blank or invalid input
 * (never guesses), so the caller can tell "empty" (use trim) from "bad" (use the result).
 */
export function parseTime(raw: string): number | null {
  const v = raw.trim();
  if (!/^\d+(:\d{1,2}){0,2}$/.test(v)) return null;
  const parts = v.split(":").map(Number);
  if (parts.slice(1).some((p) => p > 59)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}
