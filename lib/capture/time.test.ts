import { describe, expect, it } from "vitest";
import { formatTime, parseTime } from "./time";

describe("formatTime", () => {
  it("formats minutes and hours", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(3723)).toBe("1:02:03");
    expect(formatTime(65.9)).toBe("1:05");
  });
});

describe("parseTime", () => {
  it("parses seconds, mm:ss and h:mm:ss", () => {
    expect(parseTime("75")).toBe(75);
    expect(parseTime("1:15")).toBe(75);
    expect(parseTime(" 1:02:03 ")).toBe(3723);
  });
  it("rejects blank and invalid input", () => {
    for (const bad of ["", "  ", "abc", "1:75", "-5", "1:2:3:4", "1.5"]) expect(parseTime(bad)).toBeNull();
  });
});
