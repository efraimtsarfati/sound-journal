import { describe, expect, it } from "vitest";
import { CoreError } from "./errors";
import { formatInZone, isValidTimeZone, startOfDayInZone } from "./dates";

const localDate = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** The returned instant is the first one whose local date is `ymd`. */
function expectFirstInstantOfDay(ymd: string, tz: string) {
  const start = startOfDayInZone(ymd, tz);
  expect(localDate(start, tz)).toBe(ymd);
  expect(localDate(new Date(start.getTime() - 1), tz)).not.toBe(ymd);
  return start;
}

describe("startOfDayInZone", () => {
  it("ordinary days and DST days in America/Toronto", () => {
    expect(startOfDayInZone("2026-01-15", "America/Toronto").toISOString()).toBe("2026-01-15T05:00:00.000Z");
    expect(startOfDayInZone("2026-07-15", "America/Toronto").toISOString()).toBe("2026-07-15T04:00:00.000Z");
    expectFirstInstantOfDay("2026-03-08", "America/Toronto");
    expectFirstInstantOfDay("2026-11-01", "America/Toronto");
  });

  it("a zone whose clock skips midnight starts the day at the jump (America/Santiago)", () => {
    // Chile moves 00:00 -> 01:00 on the first Sunday on or after 2 September; find the day by scanning.
    let found = false;
    for (let day = 1; day <= 12; day++) {
      const ymd = `2026-09-${String(day).padStart(2, "0")}`;
      const start = expectFirstInstantOfDay(ymd, "America/Santiago");
      const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Santiago", hour: "2-digit", hourCycle: "h23" }).format(start));
      if (hour === 1) found = true;
    }
    expect(found).toBe(true);
  });

  it("a zone that repeats midnight starts the day at the first one (America/Havana)", () => {
    for (let day = 1; day <= 12; day++) expectFirstInstantOfDay(`2026-11-${String(day).padStart(2, "0")}`, "America/Havana");
  });

  it("refuses impossible dates and bad zones with CoreError", () => {
    expect(() => startOfDayInZone("2026-02-30", "UTC")).toThrow(CoreError);
    expect(() => startOfDayInZone("2026-02-03", "Not/AZone")).toThrow(/time zone/);
  });
});

describe("time zone helpers", () => {
  it("validates names", () => {
    expect(isValidTimeZone("America/Toronto")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
  });

  it("formatInZone uses the zone and falls back to UTC for a bad one", () => {
    const d = new Date("2026-11-21T20:05:00Z");
    expect(formatInZone(d, "America/Toronto")).toMatch(/^2026-11-21 15:05 /);
    expect(formatInZone(d, "Mars/Base")).toMatch(/^2026-11-21 20:05 UTC$/);
  });
});
