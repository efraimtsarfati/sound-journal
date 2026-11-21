import { describe, expect, it } from "vitest";
import {
  buildRedirect,
  isAllowedRedirectUri,
  isValidCodeChallenge,
  isValidCodeVerifier,
  parseRegistration,
  readAuthorizeParams,
} from "./oauth-rules";

describe("isAllowedRedirectUri", () => {
  it("accepts https and loopback http", () => {
    for (const u of [
      "https://claude.ai/api/mcp/auth_callback",
      "http://localhost:33418/callback",
      "http://127.0.0.1:5000/cb",
      "http://[::1]:8080/cb",
    ]) {
      expect(isAllowedRedirectUri(u), u).toBe(true);
    }
  });
  it("rejects everything else", () => {
    for (const u of [
      "http://example.test/cb",
      "javascript:alert(1)",
      "data:text/html,hi",
      "file:///etc/passwd",
      "myapp://callback",
      "https://example.test/cb#frag",
      "/relative",
      "https://user:pw@example.test/cb",
      "https://example.test/" + "a".repeat(2000),
      "https://example.test/a b",
      "https://example.test/a\tb",
      "https://example.test\\evil",
      "",
    ]) {
      expect(isAllowedRedirectUri(u), u).toBe(false);
    }
    expect(isAllowedRedirectUri(42)).toBe(false);
    expect(isAllowedRedirectUri(undefined)).toBe(false);
  });
});

describe("PKCE formats", () => {
  it("challenge is exactly 43 url-safe chars", () => {
    expect(isValidCodeChallenge("a".repeat(43))).toBe(true);
    expect(isValidCodeChallenge("a".repeat(42))).toBe(false);
    expect(isValidCodeChallenge("a".repeat(44))).toBe(false);
    expect(isValidCodeChallenge("a".repeat(42) + "=")).toBe(false);
    expect(isValidCodeChallenge(undefined)).toBe(false);
  });
  it("verifier is 43 to 128 unreserved chars", () => {
    expect(isValidCodeVerifier("a".repeat(43))).toBe(true);
    expect(isValidCodeVerifier("a-._~".repeat(25))).toBe(true);
    expect(isValidCodeVerifier("a".repeat(128))).toBe(true);
    expect(isValidCodeVerifier("a".repeat(42))).toBe(false);
    expect(isValidCodeVerifier("a".repeat(129))).toBe(false);
    expect(isValidCodeVerifier("a".repeat(42) + "+")).toBe(false);
  });
});

describe("parseRegistration", () => {
  const ok = { redirect_uris: ["https://claude.ai/cb"] };
  it("accepts a minimal body and defaults the name", () => {
    expect(parseRegistration(ok)).toEqual({
      ok: true,
      value: { name: "MCP client", redirectUris: ["https://claude.ai/cb"] },
    });
  });
  it("cleans and caps the name, drops unknown fields", () => {
    const r = parseRegistration({ ...ok, client_name: "  My\u0000 App\n" + "x".repeat(200), junk: 1 });
    expect(r.ok && r.value.name.length).toBeLessThanOrEqual(100);
    expect(r.ok && r.value.name.startsWith("My App")).toBe(true);
    expect(r.ok && Object.keys(r.value).sort()).toEqual(["name", "redirectUris"]);
  });
  it("rejects bad redirect_uris", () => {
    for (const body of [
      {},
      { redirect_uris: [] },
      { redirect_uris: "https://x.test/cb" },
      { redirect_uris: Array.from({ length: 11 }, (_, i) => `https://x.test/${i}`) },
      { redirect_uris: ["http://x.test/cb"] },
      { redirect_uris: [1] },
    ]) {
      expect(parseRegistration(body)).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    }
  });
  it("rejects unsupported metadata and non-objects", () => {
    expect(parseRegistration({ ...ok, token_endpoint_auth_method: "client_secret_basic" })).toMatchObject({ ok: false });
    expect(parseRegistration({ ...ok, token_endpoint_auth_method: "none" })).toMatchObject({ ok: true });
    expect(parseRegistration({ ...ok, grant_types: ["password"] })).toMatchObject({ ok: false });
    expect(parseRegistration({ ...ok, grant_types: ["authorization_code", "refresh_token"] })).toMatchObject({ ok: true });
    expect(parseRegistration({ ...ok, response_types: ["token"] })).toMatchObject({ ok: false });
    expect(parseRegistration(null)).toMatchObject({ ok: false });
    expect(parseRegistration([])).toMatchObject({ ok: false });
  });
});

describe("authorize params and redirects", () => {
  it("reads from URLSearchParams and plain records, missing as empty", () => {
    const fromQuery = readAuthorizeParams(new URLSearchParams("client_id=c&state=s"));
    expect(fromQuery).toMatchObject({ clientId: "c", state: "s", redirectUri: "" });
    expect(readAuthorizeParams({ client_id: ["a", "b"], state: "x" })).toMatchObject({ clientId: "", state: "x" });
  });
  it("buildRedirect keeps the existing query and encodes state", () => {
    const url = new URL(buildRedirect("https://x.test/cb?keep=1", { code: "c", state: "a b&c=d", skip: undefined }));
    expect(url.searchParams.get("keep")).toBe("1");
    expect(url.searchParams.get("code")).toBe("c");
    expect(url.searchParams.get("state")).toBe("a b&c=d");
    expect(url.searchParams.has("skip")).toBe(false);
  });
});
