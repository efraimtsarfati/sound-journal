import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  isPublicPath,
  safeNext,
  verifySessionToken,
  SESSION_MAX_AGE_SEC,
} from "./session";

describe("session token", () => {
  const now = 1_700_000_000_000;
  it("round-trips", () => {
    expect(verifySessionToken("s", createSessionToken("s", now), now + 1000)).toBe(true);
  });
  it("rejects wrong secret, tampering, expiry, missing secret", () => {
    const t = createSessionToken("s", now);
    expect(verifySessionToken("other", t, now)).toBe(false);
    expect(verifySessionToken("s", t.replace(/^\d+/, "9999999999"), now)).toBe(false);
    expect(verifySessionToken("s", t, now + (SESSION_MAX_AGE_SEC + 1) * 1000)).toBe(false);
    expect(verifySessionToken(undefined, t, now)).toBe(false);
    expect(verifySessionToken("s", "garbage", now)).toBe(false);
    expect(verifySessionToken("s", undefined, now)).toBe(false);
  });
});

describe("isPublicPath", () => {
  it("exempts self-authenticating paths", () => {
    for (const p of [
      "/login",
      "/api/auth/login",
      "/api/health",
      "/manifest.webmanifest",
      "/icon-192.png",
      "/icon-512.png",
      "/apple-touch-icon.png",
      "/.well-known/oauth-authorization-server",
      "/oauth/authorize",
      "/api/oauth/token",
      "/api/mcp",
      "/api/cron/cleanup",
      "/api/oauth/register",
      "/api/oauth/authorize",
      "/.well-known/oauth-protected-resource/api/mcp",
    ]) {
      expect(isPublicPath(p)).toBe(true);
    }
  });
  it("protects everything else", () => {
    for (const p of [
      "/",
      "/entries",
      "/api/entries",
      "/oauth/other",
      "/api/mcpx",
      "/login/x",
      "/api/mcp/x",
      "/api/mcp/sse",
      "/oauth/authorize/x",
      "/.well-known",
    ]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });
});

describe("safeNext", () => {
  it("allows only local paths", () => {
    expect(safeNext("/entries?a=1")).toBe("/entries?a=1");
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext("/\\evil.com")).toBe("/");
    expect(safeNext("/\t/evil.com")).toBe("/");
    expect(safeNext("/\n/evil.com")).toBe("/");
    expect(safeNext("/\r/evil.com")).toBe("/");
    expect(safeNext(null)).toBe("/");
    expect(safeNext(["/a"])).toBe("/");
    expect(safeNext(undefined)).toBe("/");
  });
});
