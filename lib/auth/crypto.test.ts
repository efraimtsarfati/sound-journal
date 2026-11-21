import { describe, expect, it } from "vitest";
import { isCronAuthorized } from "./cron";
import { pkceS256, randomToken, safeEqual, sha256Hex } from "./crypto";
import {
  appOrigin,
  authorizationServerMetadata,
  mcpResource,
  protectedResourceMetadata,
} from "./oauth-metadata";

describe("crypto", () => {
  it("pkceS256 matches the RFC 7636 Appendix B vector", () => {
    expect(pkceS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
  it("sha256Hex gives the known digest", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("randomToken is url-safe, 43 chars for 32 bytes, and unique", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const t = randomToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      seen.add(t);
    }
    expect(seen.size).toBe(50);
    expect(randomToken(16)).toHaveLength(22);
  });
  it("safeEqual compares exactly", () => {
    expect(safeEqual("a", "a")).toBe(true);
    expect(safeEqual("a", "b")).toBe(false);
    expect(safeEqual("a", "a ")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("short", "a much longer string")).toBe(false);
  });
});

describe("isCronAuthorized", () => {
  const secret = "0123456789abcdef-secret";
  it("accepts only the exact bearer header", () => {
    expect(isCronAuthorized(secret, `Bearer ${secret}`)).toBe(true);
    expect(isCronAuthorized(secret, `bearer ${secret}`)).toBe(false);
    expect(isCronAuthorized(secret, `Bearer  ${secret}`)).toBe(false);
    expect(isCronAuthorized(secret, `Bearer ${secret} `)).toBe(false);
    expect(isCronAuthorized(secret, "Bearer wrong")).toBe(false);
    expect(isCronAuthorized(secret, null)).toBe(false);
    expect(isCronAuthorized(secret, undefined)).toBe(false);
  });
  it("fails closed when the secret is unset, empty or short", () => {
    expect(isCronAuthorized(undefined, "Bearer undefined")).toBe(false);
    expect(isCronAuthorized("", "Bearer ")).toBe(false);
    expect(isCronAuthorized("", "")).toBe(false);
    expect(isCronAuthorized("short", "Bearer short")).toBe(false);
    expect(isCronAuthorized("a".repeat(15), `Bearer ${"a".repeat(15)}`)).toBe(false);
    expect(isCronAuthorized("a".repeat(16), `Bearer ${"a".repeat(16)}`)).toBe(true);
  });
});

describe("oauth metadata", () => {
  it("normalizes APP_ORIGIN", () => {
    expect(appOrigin("https://sound-journal.vercel.app/")).toBe("https://sound-journal.vercel.app");
    expect(appOrigin("  https://example.test//  ")).toBe("https://example.test");
    expect(appOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(appOrigin("http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000");
  });
  it("fails closed on unset or unsafe values", () => {
    expect(appOrigin(undefined)).toBeNull();
    expect(appOrigin("")).toBeNull();
    expect(appOrigin("http://example.test")).toBeNull();
    expect(appOrigin("not a url")).toBeNull();
    expect(appOrigin("https://example.test/path")).toBeNull();
    expect(appOrigin("https://user:pw@example.test")).toBeNull();
  });
  it("publishes absolute endpoints and S256 only", () => {
    const o = "https://sound-journal.vercel.app";
    const as = authorizationServerMetadata(o);
    expect(as.issuer).toBe(o);
    expect(as.authorization_endpoint).toBe(`${o}/oauth/authorize`);
    expect(as.token_endpoint).toBe(`${o}/api/oauth/token`);
    expect(as.registration_endpoint).toBe(`${o}/api/oauth/register`);
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(as.authorization_response_iss_parameter_supported).toBe(true);
    const pr = protectedResourceMetadata(o);
    expect(pr.resource).toBe(mcpResource(o));
    expect(pr.authorization_servers).toEqual([o]);
  });
});
