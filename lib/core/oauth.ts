import { and, asc, count, desc, eq, gt, inArray, notExists, sql } from "drizzle-orm";
import { pkceS256, randomToken, safeEqual, sha256Hex } from "../auth/crypto";
import { mcpResource } from "../auth/oauth-metadata";
import {
  oauthClients,
  oauthCodes,
  oauthGrants,
  oauthTokens,
  type Db,
  type OauthClient,
} from "../db";
import { CoreError } from "./errors";
import {
  MAX_STATE_LENGTH,
  isAllowedRedirectUri,
  isValidCodeChallenge,
  isValidCodeVerifier,
  sameResource,
  type AuthorizeParams,
  type ParsedRegistration,
} from "./oauth-rules";

export const CODE_TTL_SEC = 60;
export const ACCESS_TTL_SEC = 60 * 60;
export const REFRESH_TTL_SEC = 90 * 24 * 60 * 60;
export const MAX_CLIENTS = 200;
export const ORPHAN_CLIENT_DAYS = 7;
export const LAST_USED_THROTTLE_SEC = 300;

const addSec = (d: Date, sec: number) => new Date(d.getTime() + sec * 1000);

/**
 * Stores a dynamically registered public client. At the cap, evicts the oldest clients that
 * have no grant and no live code (same transaction, serialized by an advisory lock); returns
 * null only when every client is in use.
 */
export async function registerClient(
  db: Db,
  input: ParsedRegistration,
  now: Date = new Date(),
): Promise<OauthClient | null> {
  if (!input.redirectUris.every(isAllowedRedirectUri)) {
    throw new CoreError("invalid_input", "Redirect URIs must be https or loopback http.");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('oauth_client_registry'))`);
    const [{ n }] = await tx.select({ n: count() }).from(oauthClients);
    if (n >= MAX_CLIENTS) {
      const needed = n - MAX_CLIENTS + 1;
      const evictable = await tx
        .select({ id: oauthClients.id })
        .from(oauthClients)
        .where(
          and(
            notExists(
              tx.select({ x: sql`1` }).from(oauthGrants).where(eq(oauthGrants.clientId, oauthClients.id)),
            ),
            notExists(
              tx
                .select({ x: sql`1` })
                .from(oauthCodes)
                .where(and(eq(oauthCodes.clientId, oauthClients.id), gt(oauthCodes.expiresAt, now))),
            ),
          ),
        )
        .orderBy(asc(oauthClients.createdAt), asc(oauthClients.id))
        .limit(needed);
      if (evictable.length < needed) return null;
      await tx.delete(oauthClients).where(
        inArray(
          oauthClients.id,
          evictable.map((c) => c.id),
        ),
      );
    }
    const [row] = await tx
      .insert(oauthClients)
      .values({ id: crypto.randomUUID(), name: input.name, redirectUris: input.redirectUris })
      .returning();
    return row;
  });
}

export async function getClient(db: Db, clientId: string): Promise<OauthClient | null> {
  if (!clientId) return null;
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.id, clientId));
  return row ?? null;
}

export type AuthorizeCheck =
  | { ok: true; client: OauthClient }
  /** The client or redirect URI is not trusted: show an error page, never redirect. */
  | {
      ok: false;
      redirect: false;
      error: "invalid_client" | "invalid_redirect_uri";
      description: string;
    }
  /** Safe to send the error back to the (validated) redirect URI. */
  | {
      ok: false;
      redirect: true;
      error: "unsupported_response_type" | "invalid_request" | "invalid_target";
      description: string;
      redirectUri: string;
      state: string;
    };

/** Validates an authorization request. Client and redirect URI first; only then redirectable errors. */
export async function checkAuthorizeRequest(
  db: Db,
  p: AuthorizeParams,
  origin: string,
): Promise<AuthorizeCheck> {
  const client = await getClient(db, p.clientId);
  if (!client) {
    return { ok: false, redirect: false, error: "invalid_client", description: "Unknown client." };
  }
  if (!p.redirectUri || !client.redirectUris.some((u) => u === p.redirectUri)) {
    return {
      ok: false,
      redirect: false,
      error: "invalid_redirect_uri",
      description: "The redirect URI does not match this client's registration.",
    };
  }
  const fail = (
    error: "unsupported_response_type" | "invalid_request" | "invalid_target",
    description: string,
  ): AuthorizeCheck => ({
    ok: false,
    redirect: true,
    error,
    description,
    redirectUri: p.redirectUri,
    state: p.state,
  });
  if (p.responseType !== "code") return fail("unsupported_response_type", "response_type must be code.");
  if (p.codeChallengeMethod !== "S256") return fail("invalid_request", "code_challenge_method must be S256.");
  if (!isValidCodeChallenge(p.codeChallenge)) return fail("invalid_request", "Invalid code_challenge.");
  if (p.state.length > MAX_STATE_LENGTH) return fail("invalid_request", "state is too long.");
  if (p.resource && !sameResource(p.resource, mcpResource(origin))) {
    return fail("invalid_target", "Unknown resource.");
  }
  return { ok: true, client };
}

/** Creates a single-use code (256-bit, stored only as a hash) and returns the raw value. */
export async function issueAuthorizationCode(
  db: Db,
  userId: string,
  input: { clientId: string; redirectUri: string; codeChallenge: string },
  now: Date = new Date(),
): Promise<string> {
  const code = randomToken();
  await db.insert(oauthCodes).values({
    codeHash: sha256Hex(code),
    clientId: input.clientId,
    userId,
    codeChallenge: input.codeChallenge,
    redirectUri: input.redirectUri,
    expiresAt: addSec(now, CODE_TTL_SEC),
  });
  return code;
}

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export type TokenResult = ({ ok: true } & TokenPair) | { ok: false; error: "invalid_grant" };

async function insertTokenPair(db: Db, grantId: string, now: Date): Promise<TokenPair> {
  const accessToken = randomToken();
  const refreshToken = randomToken();
  await db.insert(oauthTokens).values([
    { tokenHash: sha256Hex(accessToken), grantId, kind: "access", expiresAt: addSec(now, ACCESS_TTL_SEC) },
    { tokenHash: sha256Hex(refreshToken), grantId, kind: "refresh", expiresAt: addSec(now, REFRESH_TTL_SEC) },
  ]);
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SEC };
}

/**
 * Exchanges a code for tokens. The code is consumed by DELETE ... RETURNING before any check,
 * so a failed attempt burns it and a concurrent second exchange gets nothing.
 */
export async function exchangeAuthorizationCode(
  db: Db,
  input: { code: string; clientId: string; redirectUri: string; codeVerifier: string },
  now: Date = new Date(),
): Promise<TokenResult> {
  const invalid: TokenResult = { ok: false, error: "invalid_grant" };
  return db.transaction(async (tx): Promise<TokenResult> => {
    const [row] = await tx
      .delete(oauthCodes)
      .where(eq(oauthCodes.codeHash, sha256Hex(input.code)))
      .returning();
    if (!row) return invalid;
    if (row.expiresAt <= now) return invalid;
    if (row.clientId !== input.clientId) return invalid;
    if (row.redirectUri !== input.redirectUri) return invalid;
    if (!isValidCodeVerifier(input.codeVerifier)) return invalid;
    if (!safeEqual(pkceS256(input.codeVerifier), row.codeChallenge)) return invalid;

    // Serialize grant replacement for this client.
    await tx.select({ id: oauthClients.id }).from(oauthClients).where(eq(oauthClients.id, row.clientId)).for("update");
    await tx
      .delete(oauthGrants)
      .where(and(eq(oauthGrants.clientId, row.clientId), eq(oauthGrants.userId, row.userId)));
    const [grant] = await tx
      .insert(oauthGrants)
      .values({ clientId: row.clientId, userId: row.userId })
      .returning();
    return { ok: true, ...(await insertTokenPair(tx, grant.id, now)) };
  });
}

/**
 * Rotates a refresh token. Presenting an already-used refresh token is treated as theft:
 * the whole grant is deleted (cascading to every token) and the revocation is committed.
 */
export async function refreshAccessToken(
  db: Db,
  input: { refreshToken: string; clientId: string },
  now: Date = new Date(),
): Promise<TokenResult> {
  const invalid: TokenResult = { ok: false, error: "invalid_grant" };
  return db.transaction(async (tx): Promise<TokenResult> => {
    const [row] = await tx
      .select({ token: oauthTokens, grant: oauthGrants })
      .from(oauthTokens)
      .innerJoin(oauthGrants, eq(oauthTokens.grantId, oauthGrants.id))
      .where(eq(oauthTokens.tokenHash, sha256Hex(input.refreshToken)))
      .for("update", { of: [oauthTokens, oauthGrants] });
    if (!row) return invalid;
    if (row.token.kind !== "refresh") return invalid;
    if (row.grant.clientId !== input.clientId) return invalid;
    if (row.token.expiresAt <= now) return invalid;
    if (row.token.usedAt) {
      await tx.delete(oauthGrants).where(eq(oauthGrants.id, row.grant.id));
      return invalid;
    }
    await tx.update(oauthTokens).set({ usedAt: now }).where(eq(oauthTokens.tokenHash, row.token.tokenHash));
    const pair = await insertTokenPair(tx, row.grant.id, now);
    await tx.update(oauthGrants).set({ lastUsedAt: now }).where(eq(oauthGrants.id, row.grant.id));
    return { ok: true, ...pair };
  });
}

export type VerifiedToken = {
  userId: string;
  grantId: string;
  clientId: string;
  clientName: string;
};

/** Resolves a bearer access token to its owner, or null. Refresh tokens never authenticate. */
export async function verifyAccessToken(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<VerifiedToken | null> {
  if (!token) return null;
  const [row] = await db
    .select({ token: oauthTokens, grant: oauthGrants, client: oauthClients })
    .from(oauthTokens)
    .innerJoin(oauthGrants, eq(oauthTokens.grantId, oauthGrants.id))
    .innerJoin(oauthClients, eq(oauthGrants.clientId, oauthClients.id))
    .where(eq(oauthTokens.tokenHash, sha256Hex(token)));
  if (!row || row.token.kind !== "access" || row.token.expiresAt <= now) return null;
  const last = row.grant.lastUsedAt;
  if (!last || now.getTime() - last.getTime() >= LAST_USED_THROTTLE_SEC * 1000) {
    await db.update(oauthGrants).set({ lastUsedAt: now }).where(eq(oauthGrants.id, row.grant.id));
  }
  return {
    userId: row.grant.userId,
    grantId: row.grant.id,
    clientId: row.client.id,
    clientName: row.client.name,
  };
}

export type GrantSummary = {
  id: string;
  clientId: string;
  clientName: string;
  createdAt: Date;
  lastUsedAt: Date | null;
};

export async function listGrants(db: Db, userId: string): Promise<GrantSummary[]> {
  const rows = await db
    .select({
      id: oauthGrants.id,
      clientId: oauthGrants.clientId,
      clientName: oauthClients.name,
      createdAt: oauthGrants.createdAt,
      lastUsedAt: oauthGrants.lastUsedAt,
    })
    .from(oauthGrants)
    .innerJoin(oauthClients, eq(oauthGrants.clientId, oauthClients.id))
    .where(eq(oauthGrants.userId, userId))
    .orderBy(desc(oauthGrants.createdAt));
  return rows;
}

/** Deletes the grant (and so every token it holds). Scoped by user. */
export async function revokeGrant(db: Db, userId: string, grantId: string): Promise<void> {
  const rows = await db
    .delete(oauthGrants)
    .where(and(eq(oauthGrants.id, grantId), eq(oauthGrants.userId, userId)))
    .returning({ id: oauthGrants.id });
  if (rows.length === 0) throw new CoreError("not_found", "No such connected app.");
}
