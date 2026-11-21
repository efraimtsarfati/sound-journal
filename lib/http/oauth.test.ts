import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pkceS256, randomToken } from "../auth/crypto";
import { MAX_FAILS, clearFailures, LOGIN_KEY } from "../core";
import type { Db } from "../db";
import { createTestDb } from "../db/test-utils";
import { preflight } from "./cors";
import { handleCleanup } from "./cron";
import { handleAuthorizationServerMetadata, handleProtectedResourceMetadata } from "./discovery";
import { handleConsent, handleRegister, handleToken, type OAuthEnv } from "./oauth";

const ORIGIN = "https://journal.example.test";
const REDIRECT = "https://agent.example.test/callback";
const ENV: OAuthEnv = { APP_ORIGIN: ORIGIN, APP_PASSWORD: "correct horse" };

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  const t = await createTestDb();
  db = t.db as unknown as Db;
  close = t.close;
});
afterAll(() => close());
beforeEach(() => clearFailures(db, LOGIN_KEY));

function registerReq(body: unknown, raw = false) {
  return new Request(`${ORIGIN}/api/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

async function register(uris = [REDIRECT]) {
  const res = await handleRegister(registerReq({ client_name: "Test Agent", redirect_uris: uris }), db);
  expect(res.status).toBe(201);
  return (await res.json()) as { client_id: string };
}

function consentReq(fields: Record<string, string>, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/oauth/authorize`, {
    method: "POST",
    headers: { origin: ORIGIN, ...headers },
    body: new URLSearchParams(fields),
  });
}

function authFields(clientId: string, challenge: string, over: Record<string, string> = {}) {
  return {
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
    decision: "approve",
    password: "correct horse",
    ...over,
  };
}

function tokenReq(fields: Record<string, string>, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields),
  });
}

describe("register", () => {
  it("returns 201 with no secret and CORS", async () => {
    const res = await handleRegister(registerReq({ client_name: "A", redirect_uris: [REDIRECT], junk: 1 }), db);
    expect(res.status).toBe(201);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = await res.json();
    expect(body.client_id).toBeTruthy();
    expect(body.client_secret).toBeUndefined();
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body.redirect_uris).toEqual([REDIRECT]);
  });
  it("413 over 10 KB, 400 for bad JSON and bad URIs", async () => {
    const big = await handleRegister(registerReq({ redirect_uris: [REDIRECT], client_name: "x".repeat(11_000) }), db);
    expect(big.status).toBe(413);
    expect((await handleRegister(registerReq("{nope", true), db)).status).toBe(400);
    const bad = await handleRegister(registerReq({ redirect_uris: ["http://evil.test/cb"] }), db);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("invalid_redirect_uri");
  });
  it("answers CORS preflight", () => {
    const res = preflight();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("token endpoint errors", () => {
  it("rejects non-form bodies, unknown grant types and unknown clients", async () => {
    const json = await handleToken(
      new Request(`${ORIGIN}/api/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      db,
    );
    expect(json.status).toBe(400);
    expect((await json.json()).error).toBe("invalid_request");

    const { client_id } = await register();
    const grant = await handleToken(tokenReq({ grant_type: "password", client_id }), db);
    expect((await grant.json()).error).toBe("unsupported_grant_type");

    const unknown = await handleToken(tokenReq({ grant_type: "refresh_token", client_id: "nope", refresh_token: "x" }), db);
    expect(unknown.status).toBe(401);
    expect((await unknown.json()).error).toBe("invalid_client");
    expect(unknown.headers.get("cache-control")).toBe("no-store");

    const missing = await handleToken(tokenReq({ grant_type: "authorization_code", client_id }), db);
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toBe("invalid_request");
  });
  it("a Basic username must agree with the body client_id", async () => {
    const { client_id } = await register();
    const basic = "Basic " + Buffer.from("other:").toString("base64");
    const res = await handleToken(tokenReq({ grant_type: "refresh_token", client_id, refresh_token: "x" }, { authorization: basic }), db);
    expect(res.status).toBe(401);
  });
});

describe("end to end", () => {
  it("register, consent, token, refresh", async () => {
    const { client_id } = await register();
    const verifier = randomToken();
    const consent = await handleConsent(consentReq(authFields(client_id, pkceS256(verifier))), db, ENV);
    expect(consent.status).toBe(303);
    const loc = new URL(consent.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe(REDIRECT);
    expect(loc.searchParams.get("state")).toBe("xyz");
    expect(loc.searchParams.get("iss")).toBe(ORIGIN);
    const code = loc.searchParams.get("code")!;
    expect(code).toBeTruthy();

    const tokenRes = await handleToken(
      tokenReq({ grant_type: "authorization_code", client_id, code, redirect_uri: REDIRECT, code_verifier: verifier }),
      db,
    );
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.headers.get("cache-control")).toBe("no-store");
    expect(tokenRes.headers.get("access-control-allow-origin")).toBe("*");
    const tokens = await tokenRes.json();
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600 });

    const replay = await handleToken(
      tokenReq({ grant_type: "authorization_code", client_id, code, redirect_uri: REDIRECT, code_verifier: verifier }),
      db,
    );
    expect(replay.status).toBe(400);
    expect((await replay.json()).error).toBe("invalid_grant");

    const refreshed = await handleToken(
      tokenReq({ grant_type: "refresh_token", client_id, refresh_token: tokens.refresh_token }),
      db,
    );
    expect(refreshed.status).toBe(200);
    const next = await refreshed.json();
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
  });
});

describe("consent", () => {
  it("a wrong password goes back to the form with auth_error and no code", async () => {
    const { client_id } = await register();
    const res = await handleConsent(consentReq(authFields(client_id, pkceS256(randomToken()), { password: "nope" })), db, ENV);
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe(`${ORIGIN}/oauth/authorize`);
    expect(loc.searchParams.get("auth_error")).toBe("invalid");
    expect(loc.searchParams.get("client_id")).toBe(client_id);
    expect(loc.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(loc.searchParams.has("code")).toBe(false);
  });

  it("locks after repeated wrong passwords and then refuses the right one", async () => {
    const { client_id } = await register();
    const challenge = pkceS256(randomToken());
    let last = "";
    for (let i = 0; i < MAX_FAILS; i++) {
      const res = await handleConsent(consentReq(authFields(client_id, challenge, { password: "nope" })), db, ENV);
      last = new URL(res.headers.get("location")!).searchParams.get("auth_error")!;
    }
    expect(last).toBe("locked");
    const res = await handleConsent(consentReq(authFields(client_id, challenge)), db, ENV);
    expect(new URL(res.headers.get("location")!).searchParams.get("auth_error")).toBe("locked");
  });

  it("deny redirects with access_denied, state and iss, without asking for the password", async () => {
    const { client_id } = await register();
    const res = await handleConsent(
      consentReq(authFields(client_id, pkceS256(randomToken()), { decision: "deny", password: "" })),
      db,
      ENV,
    );
    const loc = new URL(res.headers.get("location")!);
    expect(res.status).toBe(303);
    expect(loc.searchParams.get("error")).toBe("access_denied");
    expect(loc.searchParams.get("state")).toBe("xyz");
    expect(loc.searchParams.get("iss")).toBe(ORIGIN);
  });

  it("unknown client or mismatched redirect is a 400, never a redirect", async () => {
    const { client_id } = await register();
    const challenge = pkceS256(randomToken());
    const unknown = await handleConsent(consentReq(authFields("nope", challenge)), db, ENV);
    expect(unknown.status).toBe(400);
    expect(unknown.headers.get("location")).toBeNull();
    const mismatch = await handleConsent(
      consentReq(authFields(client_id, challenge, { redirect_uri: "https://evil.example.test/cb" })),
      db,
      ENV,
    );
    expect(mismatch.status).toBe(400);
    expect(mismatch.headers.get("location")).toBeNull();
  });

  it("invalid PKCE method redirects the error to the registered URI", async () => {
    const { client_id } = await register();
    const res = await handleConsent(
      consentReq(authFields(client_id, pkceS256(randomToken()), { code_challenge_method: "plain" })),
      db,
      ENV,
    );
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe(REDIRECT);
    expect(loc.searchParams.get("error")).toBe("invalid_request");
  });

  it("refuses a foreign Origin", async () => {
    const { client_id } = await register();
    const res = await handleConsent(
      consentReq(authFields(client_id, pkceS256(randomToken())), { origin: "https://evil.example.test" }),
      db,
      ENV,
    );
    expect(res.status).toBe(403);
  });

  it("reports a config problem when APP_PASSWORD or APP_ORIGIN is unset", async () => {
    const { client_id } = await register();
    const f = authFields(client_id, pkceS256(randomToken()));
    const noPw = await handleConsent(consentReq(f), db, { APP_ORIGIN: ORIGIN });
    expect(new URL(noPw.headers.get("location")!).searchParams.get("auth_error")).toBe("config");
    const noOrigin = await handleConsent(consentReq(f), db, { APP_PASSWORD: "x" });
    expect(noOrigin.status).toBe(503);
  });
});

describe("discovery", () => {
  it("serves metadata with CORS and fails closed without APP_ORIGIN", async () => {
    const res = handleAuthorizationServerMetadata(ORIGIN + "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect((await res.json()).issuer).toBe(ORIGIN);
    expect(handleAuthorizationServerMetadata(undefined).status).toBe(503);
    expect(handleProtectedResourceMetadata(undefined, []).status).toBe(503);
  });
  it("serves the protected resource at the root and /api/mcp only", async () => {
    for (const path of [undefined, [], ["api", "mcp"]]) {
      const res = handleProtectedResourceMetadata(ORIGIN, path);
      expect(res.status).toBe(200);
      expect((await res.json()).resource).toBe(`${ORIGIN}/api/mcp`);
    }
    expect(handleProtectedResourceMetadata(ORIGIN, ["other"]).status).toBe(404);
    expect(handleProtectedResourceMetadata(ORIGIN, ["api", "mcp", "x"]).status).toBe(404);
  });
});

describe("cron cleanup", () => {
  const SECRET = "0123456789abcdef0123";
  const explode = (): Db => {
    throw new Error("database touched");
  };
  const req = (authorization?: string) =>
    new Request(`${ORIGIN}/api/cron/cleanup`, { headers: authorization ? { authorization } : {} });

  it("returns 401 before any database access unless authorized", async () => {
    expect((await handleCleanup(req(), explode, SECRET)).status).toBe(401);
    expect((await handleCleanup(req("Bearer wrong"), explode, SECRET)).status).toBe(401);
    expect((await handleCleanup(req(`Bearer ${SECRET}`), explode, undefined)).status).toBe(401);
    expect((await handleCleanup(req("Bearer undefined"), explode, undefined)).status).toBe(401);
    expect((await handleCleanup(req(`Bearer ${SECRET}`), explode, "")).status).toBe(401);
  });
  it("returns counts only when authorized", async () => {
    const res = await handleCleanup(req(`Bearer ${SECRET}`), () => db, SECRET);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.purged).toEqual(expect.objectContaining({ entries: expect.any(Number) }));
    expect(body.auth).toEqual(expect.objectContaining({ codes: expect.any(Number) }));
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });
});
