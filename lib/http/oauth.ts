import { appOrigin } from "../auth/oauth-metadata";
import {
  MAX_REGISTRATION_BYTES,
  OWNER_USER_ID,
  attemptLogin,
  buildRedirect,
  checkAuthorizeRequest,
  exchangeAuthorizationCode,
  getClient,
  issueAuthorizationCode,
  parseRegistration,
  readAuthorizeParams,
  refreshAccessToken,
  registerClient,
  type AuthorizeParams,
  type TokenResult,
} from "../core";
import type { Db } from "../db";
import { withCors } from "./cors";

export type OAuthEnv = { APP_ORIGIN?: string; APP_PASSWORD?: string };

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function oauthError(status: number, error: string, description?: string): Response {
  return withCors(json({ error, ...(description ? { error_description: description } : {}) }, status));
}

/** POST /api/oauth/register (RFC 7591), public clients only. */
export async function handleRegister(request: Request, db: Db): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_REGISTRATION_BYTES) return oauthError(413, "invalid_client_metadata", "Body too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_REGISTRATION_BYTES) {
    return oauthError(413, "invalid_client_metadata", "Body too large.");
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return oauthError(400, "invalid_client_metadata", "Body must be JSON.");
  }
  const parsed = parseRegistration(body);
  if (!parsed.ok) return oauthError(400, parsed.error, parsed.description);
  const client = await registerClient(db, parsed.value);
  if (!client) return oauthError(503, "temporarily_unavailable", "Too many registered clients.");
  return withCors(
    json(
      {
        client_id: client.id,
        client_name: client.name,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      },
      201,
    ),
  );
}

function basicUsername(header: string | null): string | null {
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const i = decoded.indexOf(":");
    return decodeURIComponent(i < 0 ? decoded : decoded.slice(0, i));
  } catch {
    return null;
  }
}

function tokenResponse(r: TokenResult): Response {
  if (!r.ok) return oauthError(400, "invalid_grant");
  return withCors(
    json(
      {
        access_token: r.accessToken,
        token_type: "Bearer",
        expires_in: r.expiresIn,
        refresh_token: r.refreshToken,
      },
      200,
    ),
  );
}

/** POST /api/oauth/token: authorization_code (PKCE) and refresh_token grants. */
export async function handleToken(request: Request, db: Db, now: Date = new Date()): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return oauthError(400, "invalid_request", "Use application/x-www-form-urlencoded.");
  }
  const form = new URLSearchParams(await request.text());
  const bodyId = form.get("client_id");
  const basicId = basicUsername(request.headers.get("authorization"));
  if (bodyId && basicId && bodyId !== basicId) return oauthError(401, "invalid_client");
  const clientId = bodyId ?? basicId ?? "";
  const grantType = form.get("grant_type");
  if (grantType !== "authorization_code" && grantType !== "refresh_token") {
    return oauthError(400, "unsupported_grant_type");
  }
  if (!clientId || !(await getClient(db, clientId))) return oauthError(401, "invalid_client");

  if (grantType === "authorization_code") {
    const code = form.get("code");
    const redirectUri = form.get("redirect_uri");
    const codeVerifier = form.get("code_verifier");
    if (!code || !redirectUri || !codeVerifier) {
      return oauthError(400, "invalid_request", "code, redirect_uri and code_verifier are required.");
    }
    return tokenResponse(await exchangeAuthorizationCode(db, { code, clientId, redirectUri, codeVerifier }, now));
  }
  const refreshToken = form.get("refresh_token");
  if (!refreshToken) return oauthError(400, "invalid_request", "refresh_token is required.");
  return tokenResponse(await refreshAccessToken(db, { refreshToken, clientId }, now));
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, ...NO_STORE } });
}

function plain(status: number, error: string, description: string): Response {
  return json({ error, error_description: description }, status);
}

/** The query string for `/oauth/authorize`, from already-validated params. */
export function authorizeQuery(p: AuthorizeParams): URLSearchParams {
  const q = new URLSearchParams();
  const pairs: [string, string][] = [
    ["response_type", p.responseType],
    ["client_id", p.clientId],
    ["redirect_uri", p.redirectUri],
    ["code_challenge", p.codeChallenge],
    ["code_challenge_method", p.codeChallengeMethod],
    ["state", p.state],
    ["resource", p.resource],
  ];
  for (const [k, v] of pairs) if (v) q.set(k, v);
  return q;
}

/** POST /api/oauth/authorize: the consent form. Re-validates everything it is sent. */
export async function handleConsent(
  request: Request,
  db: Db,
  env: OAuthEnv,
  now: Date = new Date(),
): Promise<Response> {
  const origin = appOrigin(env.APP_ORIGIN);
  if (!origin) return plain(503, "server_error", "APP_ORIGIN is not configured.");
  const sentOrigin = request.headers.get("origin");
  if (sentOrigin !== null && sentOrigin !== origin) return plain(403, "access_denied", "Cross-origin request.");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return plain(400, "invalid_request", "Expected a form.");
  }
  const p = readAuthorizeParams(form);
  const check = await checkAuthorizeRequest(db, p, origin);
  if (!check.ok && !check.redirect) return plain(400, check.error, check.description);
  if (!check.ok) {
    return redirect(
      buildRedirect(check.redirectUri, {
        error: check.error,
        error_description: check.description,
        state: check.state,
        iss: origin,
      }),
    );
  }

  if (form.get("decision") !== "approve") {
    return redirect(buildRedirect(p.redirectUri, { error: "access_denied", state: p.state, iss: origin }));
  }

  const back = (authError: string) => {
    const q = authorizeQuery(p);
    q.set("auth_error", authError);
    return redirect(`${origin}/oauth/authorize?${q.toString()}`);
  };
  if (!env.APP_PASSWORD) return back("config");
  const password = form.get("password");
  const result = await attemptLogin(db, env.APP_PASSWORD, typeof password === "string" ? password : "", now);
  if (!result.ok) return back(result.reason);

  const code = await issueAuthorizationCode(
    db,
    OWNER_USER_ID,
    { clientId: p.clientId, redirectUri: p.redirectUri, codeChallenge: p.codeChallenge },
    now,
  );
  return redirect(buildRedirect(p.redirectUri, { code, state: p.state, iss: origin }));
}
