import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pkceS256, randomToken, sha256Hex } from "../auth/crypto";
import { mcpResource } from "../auth/oauth-metadata";
import { oauthClients, oauthCodes, oauthGrants, oauthTokens, type Db } from "../db";
import { createTestDb, insertUser } from "../db/test-utils";
import { listConnectedApps, revokeConnectedApp } from "./connector";
import { CoreError } from "./errors";
import {
  ACCESS_TTL_SEC,
  CODE_TTL_SEC,
  MAX_CLIENTS,
  REFRESH_TTL_SEC,
  checkAuthorizeRequest,
  exchangeAuthorizationCode,
  issueAuthorizationCode,
  refreshAccessToken,
  registerClient,
  verifyAccessToken,
} from "./oauth";
import type { AuthorizeParams } from "./oauth-rules";
import { OWNER_USER_ID } from "./owner";

const ORIGIN = "https://journal.example.test";
const REDIRECT = "https://agent.example.test/callback";
const t0 = new Date("2026-06-01T12:00:00Z");
const plus = (sec: number) => new Date(t0.getTime() + sec * 1000);

let db: Db;
let close: () => Promise<void>;
let raw: Awaited<ReturnType<typeof createTestDb>>["db"];
beforeAll(async () => {
  const t = await createTestDb();
  raw = t.db;
  db = t.db as unknown as Db;
  close = t.close;
});
afterAll(() => close());

async function newClient(name = "Test Agent", uris = [REDIRECT]) {
  const c = await registerClient(db, { name, redirectUris: uris });
  if (!c) throw new Error("registry full");
  return c;
}

function pkce() {
  const verifier = randomToken();
  return { verifier, challenge: pkceS256(verifier) };
}

async function getCode(clientId: string, challenge: string, now = t0, userId = OWNER_USER_ID) {
  return issueAuthorizationCode(db, userId, { clientId, redirectUri: REDIRECT, codeChallenge: challenge }, now);
}

async function connect(clientId?: string, now = t0) {
  const id = clientId ?? (await newClient()).id;
  const { verifier, challenge } = pkce();
  const code = await getCode(id, challenge, now);
  const r = await exchangeAuthorizationCode(
    db,
    { code, clientId: id, redirectUri: REDIRECT, codeVerifier: verifier },
    now,
  );
  if (!r.ok) throw new Error("exchange failed");
  return { clientId: id, ...r };
}

describe("registerClient", () => {
  it("stores redirect URIs verbatim and issues a uuid id", async () => {
    const uris = ["https://a.example.test/Cb?x=1", "http://localhost:3000/cb"];
    const c = await newClient("Verbatim", uris);
    expect(c.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(c.redirectUris).toEqual(uris);
  });
  it("refuses bad URIs even when called directly", async () => {
    await expect(registerClient(db, { name: "x", redirectUris: ["http://evil.test/cb"] })).rejects.toBeInstanceOf(CoreError);
  });
  describe("at the client cap", () => {
    async function fullRegistry() {
      const t = await createTestDb();
      const d = t.db as unknown as Db;
      const base = new Date("2026-01-01T00:00:00Z").getTime();
      await t.db.insert(oauthClients).values(
        Array.from({ length: MAX_CLIENTS }, (_, i) => ({
          id: `c${i}`,
          name: "n",
          redirectUris: [REDIRECT],
          createdAt: new Date(base + i * 1000),
        })),
      );
      return { t, d };
    }
    const reg = { name: "newcomer", redirectUris: [REDIRECT] };

    it("evicts the oldest unused client instead of refusing", async () => {
      const { t, d } = await fullRegistry();
      const c = await registerClient(d, reg);
      expect(c).not.toBeNull();
      const ids = (await t.db.select().from(oauthClients)).map((r) => r.id);
      expect(ids).toHaveLength(MAX_CLIENTS);
      expect(ids).not.toContain("c0");
      expect(ids).toContain("c1");
      await t.close();
    });

    it("skips clients with a grant or a live code, evicting the next oldest", async () => {
      const { t, d } = await fullRegistry();
      await t.db.insert(oauthGrants).values({ clientId: "c0", userId: OWNER_USER_ID });
      const now = new Date("2026-06-01T00:00:00Z");
      await t.db.insert(oauthCodes).values({
        codeHash: "h1",
        clientId: "c1",
        userId: OWNER_USER_ID,
        codeChallenge: "x",
        redirectUri: REDIRECT,
        expiresAt: new Date(now.getTime() + 30_000),
      });
      expect(await registerClient(d, reg, now)).not.toBeNull();
      const ids = (await t.db.select().from(oauthClients)).map((r) => r.id);
      expect(ids).toContain("c0");
      expect(ids).toContain("c1");
      expect(ids).not.toContain("c2");
      await t.close();
    });

    it("an expired code does not protect a client", async () => {
      const { t, d } = await fullRegistry();
      const now = new Date("2026-06-01T00:00:00Z");
      await t.db.insert(oauthCodes).values({
        codeHash: "h2",
        clientId: "c0",
        userId: OWNER_USER_ID,
        codeChallenge: "x",
        redirectUri: REDIRECT,
        expiresAt: new Date(now.getTime() - 1000),
      });
      expect(await registerClient(d, reg, now)).not.toBeNull();
      expect((await t.db.select().from(oauthClients)).map((r) => r.id)).not.toContain("c0");
      await t.close();
    });

    it("returns null only when every client has a grant", async () => {
      const { t, d } = await fullRegistry();
      await t.db.insert(oauthGrants).values(
        Array.from({ length: MAX_CLIENTS }, (_, i) => ({ clientId: `c${i}`, userId: OWNER_USER_ID })),
      );
      expect(await registerClient(d, reg)).toBeNull();
      expect(await t.db.select().from(oauthClients)).toHaveLength(MAX_CLIENTS);
      await t.close();
    });

    it("concurrent registrations never exceed the cap", async () => {
      const { t, d } = await fullRegistry();
      const results = await Promise.all(Array.from({ length: 5 }, () => registerClient(d, reg)));
      expect(results.every((r) => r !== null)).toBe(true);
      expect(await t.db.select().from(oauthClients)).toHaveLength(MAX_CLIENTS);
      await t.close();
    });
  });
});

describe("checkAuthorizeRequest", () => {
  async function params(over: Partial<AuthorizeParams> = {}): Promise<AuthorizeParams> {
    const c = await newClient();
    return {
      clientId: c.id,
      redirectUri: REDIRECT,
      responseType: "code",
      codeChallenge: pkce().challenge,
      codeChallengeMethod: "S256",
      state: "st",
      resource: "",
      ...over,
    };
  }

  it("accepts a valid request, with or without a matching resource", async () => {
    expect((await checkAuthorizeRequest(db, await params(), ORIGIN)).ok).toBe(true);
    expect((await checkAuthorizeRequest(db, await params({ resource: mcpResource(ORIGIN) }), ORIGIN)).ok).toBe(true);
    expect((await checkAuthorizeRequest(db, await params({ resource: mcpResource(ORIGIN) + "/" }), ORIGIN)).ok).toBe(true);
  });
  it("unknown client is a no-redirect error", async () => {
    const r = await checkAuthorizeRequest(db, await params({ clientId: "nope" }), ORIGIN);
    expect(r).toMatchObject({ ok: false, redirect: false, error: "invalid_client" });
  });
  it("every redirect URI variant fails without a redirect", async () => {
    for (const redirectUri of [
      REDIRECT + "/",
      "https://AGENT.example.test/callback",
      REDIRECT + "?x=1",
      "https://agent.example.test:8443/callback",
      REDIRECT + "/extra",
      "",
    ]) {
      const r = await checkAuthorizeRequest(db, await params({ redirectUri }), ORIGIN);
      expect(r, redirectUri).toMatchObject({ ok: false, redirect: false, error: "invalid_redirect_uri" });
    }
  });
  it("other problems are redirectable errors", async () => {
    const cases: [Partial<AuthorizeParams>, string][] = [
      [{ codeChallengeMethod: "" }, "invalid_request"],
      [{ codeChallengeMethod: "plain" }, "invalid_request"],
      [{ codeChallengeMethod: "s256" }, "invalid_request"],
      [{ responseType: "token" }, "unsupported_response_type"],
      [{ codeChallenge: "short" }, "invalid_request"],
      [{ state: "s".repeat(2049) }, "invalid_request"],
      [{ resource: "https://other.example.test/api/mcp" }, "invalid_target"],
    ];
    for (const [over, error] of cases) {
      const r = await checkAuthorizeRequest(db, await params(over), ORIGIN);
      expect(r, JSON.stringify(over)).toMatchObject({ ok: false, redirect: true, error, redirectUri: REDIRECT });
    }
  });
});

describe("authorization codes", () => {
  it("stores only a hash and expires at 60 seconds", async () => {
    const c = await newClient();
    const { verifier, challenge } = pkce();
    const code = await getCode(c.id, challenge);
    const rows = await raw.select().from(oauthCodes).where(eq(oauthCodes.clientId, c.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].codeHash).toBe(sha256Hex(code));
    expect(rows[0].codeHash).not.toBe(code);
    expect(rows[0].expiresAt.getTime()).toBe(plus(CODE_TTL_SEC).getTime());

    const input = { code, clientId: c.id, redirectUri: REDIRECT, codeVerifier: verifier };
    expect(await exchangeAuthorizationCode(db, input, plus(CODE_TTL_SEC))).toEqual({ ok: false, error: "invalid_grant" });

    const code2 = await getCode(c.id, challenge);
    expect((await exchangeAuthorizationCode(db, { ...input, code: code2 }, plus(CODE_TTL_SEC - 1))).ok).toBe(true);
  });

  it("success creates one grant and two hashed tokens with the right lifetimes", async () => {
    const t = await connect();
    expect(t.expiresIn).toBe(ACCESS_TTL_SEC);
    const grants = await raw.select().from(oauthGrants).where(eq(oauthGrants.clientId, t.clientId));
    expect(grants).toHaveLength(1);
    const tokens = await raw.select().from(oauthTokens).where(eq(oauthTokens.grantId, grants[0].id));
    expect(tokens).toHaveLength(2);
    const byKind = Object.fromEntries(tokens.map((x) => [x.kind, x]));
    expect(byKind.access.tokenHash).toBe(sha256Hex(t.accessToken));
    expect(byKind.refresh.tokenHash).toBe(sha256Hex(t.refreshToken));
    expect(byKind.access.expiresAt.getTime()).toBe(plus(ACCESS_TTL_SEC).getTime());
    expect(byKind.refresh.expiresAt.getTime()).toBe(plus(REFRESH_TTL_SEC).getTime());
  });

  it("a code works once", async () => {
    const c = await newClient();
    const { verifier, challenge } = pkce();
    const code = await getCode(c.id, challenge);
    const input = { code, clientId: c.id, redirectUri: REDIRECT, codeVerifier: verifier };
    expect((await exchangeAuthorizationCode(db, input, t0)).ok).toBe(true);
    expect(await exchangeAuthorizationCode(db, input, t0)).toEqual({ ok: false, error: "invalid_grant" });
  });

  it("two concurrent exchanges produce exactly one success", async () => {
    const c = await newClient();
    const { verifier, challenge } = pkce();
    const code = await getCode(c.id, challenge);
    const input = { code, clientId: c.id, redirectUri: REDIRECT, codeVerifier: verifier };
    const results = await Promise.all([
      exchangeAuthorizationCode(db, input, t0),
      exchangeAuthorizationCode(db, input, t0),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("reusing a code revokes the tokens issued from it", async () => {
    const c = await newClient();
    const { verifier, challenge } = pkce();
    const code = await getCode(c.id, challenge);
    const input = { code, clientId: c.id, redirectUri: REDIRECT, codeVerifier: verifier };
    const first = await exchangeAuthorizationCode(db, input, t0);
    if (!first.ok) throw new Error("first exchange failed");
    expect(await verifyAccessToken(db, first.accessToken, t0)).not.toBeNull();
    expect((await exchangeAuthorizationCode(db, input, plus(5))).ok).toBe(false);
    expect(await verifyAccessToken(db, first.accessToken, plus(5))).toBeNull();
    expect((await refreshAccessToken(db, { refreshToken: first.refreshToken, clientId: c.id }, plus(5))).ok).toBe(false);
    expect(await raw.select().from(oauthGrants).where(eq(oauthGrants.clientId, c.id))).toHaveLength(0);
  });

  it("reusing a code does not touch a newer grant for the same client", async () => {
    const c = await newClient();
    const a = pkce();
    const code1 = await getCode(c.id, a.challenge);
    const first = await exchangeAuthorizationCode(db, { code: code1, clientId: c.id, redirectUri: REDIRECT, codeVerifier: a.verifier }, t0);
    expect(first.ok).toBe(true);
    const second = await connect(c.id, plus(10)); // replaces the first grant
    await exchangeAuthorizationCode(db, { code: code1, clientId: c.id, redirectUri: REDIRECT, codeVerifier: a.verifier }, plus(11));
    expect(await verifyAccessToken(db, second.accessToken, plus(12))).not.toBeNull();
  });

  it("a code that failed its checks has no grant, so reusing it revokes nothing", async () => {
    const c = await newClient();
    const keep = await connect(c.id);
    const { verifier, challenge } = pkce();
    const code = await getCode(c.id, challenge);
    const base = { code, clientId: c.id, redirectUri: REDIRECT };
    expect((await exchangeAuthorizationCode(db, { ...base, codeVerifier: randomToken() }, t0)).ok).toBe(false);
    expect((await exchangeAuthorizationCode(db, { ...base, codeVerifier: verifier }, t0)).ok).toBe(false);
    expect(await verifyAccessToken(db, keep.accessToken, t0)).not.toBeNull();
  });

  it("a wrong verifier burns the code", async () => {
    const c = await newClient();
    const { verifier, challenge } = pkce();
    const code = await getCode(c.id, challenge);
    const base = { code, clientId: c.id, redirectUri: REDIRECT };
    expect((await exchangeAuthorizationCode(db, { ...base, codeVerifier: randomToken() }, t0)).ok).toBe(false);
    expect((await exchangeAuthorizationCode(db, { ...base, codeVerifier: verifier }, t0)).ok).toBe(false);
    expect((await exchangeAuthorizationCode(db, { ...base, codeVerifier: "short" }, t0)).ok).toBe(false);
  });

  it("wrong client or redirect URI fails", async () => {
    const c = await newClient();
    const other = await newClient();
    const { verifier, challenge } = pkce();
    const base = { redirectUri: REDIRECT, codeVerifier: verifier };
    const c1 = await getCode(c.id, challenge);
    expect((await exchangeAuthorizationCode(db, { ...base, code: c1, clientId: other.id }, t0)).ok).toBe(false);
    const c2 = await getCode(c.id, challenge);
    expect(
      (await exchangeAuthorizationCode(db, { ...base, code: c2, clientId: c.id, redirectUri: REDIRECT + "/" }, t0)).ok,
    ).toBe(false);
  });

  it("re-authorizing replaces the grant and revokes the old tokens", async () => {
    const first = await connect();
    const second = await connect(first.clientId);
    const grants = await raw.select().from(oauthGrants).where(eq(oauthGrants.clientId, first.clientId));
    expect(grants).toHaveLength(1);
    expect(await verifyAccessToken(db, first.accessToken, t0)).toBeNull();
    expect(await verifyAccessToken(db, second.accessToken, t0)).not.toBeNull();
  });
});

describe("refreshAccessToken", () => {
  it("rotates: new pair works, old refresh token is marked used", async () => {
    const a = await connect();
    const r = await refreshAccessToken(db, { refreshToken: a.refreshToken, clientId: a.clientId }, plus(100));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.accessToken).not.toBe(a.accessToken);
    expect(await verifyAccessToken(db, r.accessToken, plus(101))).not.toBeNull();
    const [old] = await raw.select().from(oauthTokens).where(eq(oauthTokens.tokenHash, sha256Hex(a.refreshToken)));
    expect(old.usedAt?.getTime()).toBe(plus(100).getTime());
    const [fresh] = await raw.select().from(oauthTokens).where(eq(oauthTokens.tokenHash, sha256Hex(r.refreshToken)));
    expect(fresh.expiresAt.getTime()).toBe(plus(100 + REFRESH_TTL_SEC).getTime());
  });

  it("replaying a used refresh token revokes the whole grant, including newer tokens", async () => {
    const a = await connect();
    const r = await refreshAccessToken(db, { refreshToken: a.refreshToken, clientId: a.clientId }, plus(10));
    if (!r.ok) throw new Error("refresh failed");
    expect(await refreshAccessToken(db, { refreshToken: a.refreshToken, clientId: a.clientId }, plus(20))).toEqual({
      ok: false,
      error: "invalid_grant",
    });
    expect(await verifyAccessToken(db, r.accessToken, plus(21))).toBeNull();
    expect((await refreshAccessToken(db, { refreshToken: r.refreshToken, clientId: a.clientId }, plus(22))).ok).toBe(false);
    expect(await raw.select().from(oauthGrants).where(eq(oauthGrants.clientId, a.clientId))).toHaveLength(0);
  });

  it("an access token is not a refresh token", async () => {
    const a = await connect();
    expect((await refreshAccessToken(db, { refreshToken: a.accessToken, clientId: a.clientId }, t0)).ok).toBe(false);
    expect(await verifyAccessToken(db, a.accessToken, t0)).not.toBeNull();
  });

  it("another client's id fails without revoking", async () => {
    const a = await connect();
    const other = await newClient();
    expect((await refreshAccessToken(db, { refreshToken: a.refreshToken, clientId: other.id }, t0)).ok).toBe(false);
    expect((await refreshAccessToken(db, { refreshToken: a.refreshToken, clientId: a.clientId }, t0)).ok).toBe(true);
  });

  it("expired and unknown tokens fail", async () => {
    const a = await connect();
    expect((await refreshAccessToken(db, { refreshToken: a.refreshToken, clientId: a.clientId }, plus(REFRESH_TTL_SEC))).ok).toBe(false);
    expect((await refreshAccessToken(db, { refreshToken: "nope", clientId: a.clientId }, t0)).ok).toBe(false);
  });
});

describe("verifyAccessToken", () => {
  it("returns the owner for a live access token and refuses everything else", async () => {
    const a = await connect();
    const v = await verifyAccessToken(db, a.accessToken, plus(5));
    expect(v).toMatchObject({ userId: OWNER_USER_ID, clientId: a.clientId, clientName: "Test Agent" });
    expect(await verifyAccessToken(db, a.accessToken, plus(ACCESS_TTL_SEC))).toBeNull();
    expect(await verifyAccessToken(db, "unknown", t0)).toBeNull();
    expect(await verifyAccessToken(db, "", t0)).toBeNull();
    expect(await verifyAccessToken(db, a.refreshToken, t0)).toBeNull();
  });

  it("throttles last_used_at to once per 5 minutes", async () => {
    const a = await connect();
    await verifyAccessToken(db, a.accessToken, plus(1));
    const [g1] = await raw.select().from(oauthGrants).where(eq(oauthGrants.clientId, a.clientId));
    expect(g1.lastUsedAt?.getTime()).toBe(plus(1).getTime());
    await verifyAccessToken(db, a.accessToken, plus(100));
    const [g2] = await raw.select().from(oauthGrants).where(eq(oauthGrants.clientId, a.clientId));
    expect(g2.lastUsedAt?.getTime()).toBe(plus(1).getTime());
    await verifyAccessToken(db, a.accessToken, plus(400));
    const [g3] = await raw.select().from(oauthGrants).where(eq(oauthGrants.clientId, a.clientId));
    expect(g3.lastUsedAt?.getTime()).toBe(plus(400).getTime());
  });

  it("a revoked grant stops working", async () => {
    const a = await connect();
    const [g] = await raw.select().from(oauthGrants).where(eq(oauthGrants.clientId, a.clientId));
    await revokeConnectedApp(db, OWNER_USER_ID, g.id);
    expect(await verifyAccessToken(db, a.accessToken, t0)).toBeNull();
  });
});

describe("listGrants and revokeGrant are user scoped", () => {
  it("another user cannot see or revoke the owner's grant", async () => {
    const other = await insertUser(raw);
    const c = await newClient("Scoped");
    const { verifier, challenge } = pkce();
    const code = await getCode(c.id, challenge, t0, other.id);
    const r = await exchangeAuthorizationCode(db, { code, clientId: c.id, redirectUri: REDIRECT, codeVerifier: verifier }, t0);
    expect(r.ok).toBe(true);
    const mine = await listConnectedApps(db, other.id);
    expect(mine.map((g) => g.name)).toEqual(["Scoped"]);
    expect((await listConnectedApps(db, OWNER_USER_ID)).some((g) => g.name === "Scoped")).toBe(false);
    await expect(revokeConnectedApp(db, OWNER_USER_ID, mine[0].grantId)).rejects.toMatchObject({ code: "not_found" });
    await revokeConnectedApp(db, other.id, mine[0].grantId);
    expect(await listConnectedApps(db, other.id)).toHaveLength(0);
  });
});
