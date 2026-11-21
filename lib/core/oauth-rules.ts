/** Pure OAuth validation rules (no database). See docs/architecture.md → Authentication. */

export const MAX_REDIRECT_URIS = 10;
export const MAX_URI_LENGTH = 2000;
export const MAX_CLIENT_NAME = 100;
export const MAX_STATE_LENGTH = 2048;
export const MAX_REGISTRATION_BYTES = 10 * 1024;
export const DEFAULT_CLIENT_NAME = "MCP client";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const CONTROL_OR_SPACE = /[\x00-\x20\x7f-\x9f]/;
const CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f]/g;

/** https, or http only for loopback hosts; absolute; no fragment, userinfo, whitespace or control chars. */
export function isAllowedRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length === 0 || uri.length > MAX_URI_LENGTH) return false;
  if (CONTROL_OR_SPACE.test(uri) || uri.includes("\\")) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash || uri.includes("#")) return false;
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

export function isValidCodeChallenge(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function isValidCodeVerifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9\-._~]{43,128}$/.test(value);
}

export type ParsedRegistration = { name: string; redirectUris: string[] };

export type RegistrationResult =
  | { ok: true; value: ParsedRegistration }
  | { ok: false; error: "invalid_redirect_uri" | "invalid_client_metadata"; description: string };

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** RFC 7591 request body → the fields we keep. Unknown fields are dropped. */
export function parseRegistration(body: unknown): RegistrationResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "invalid_client_metadata", description: "Body must be a JSON object." };
  }
  const b = body as Record<string, unknown>;
  const uris = b.redirect_uris;
  if (!isStringArray(uris) || uris.length < 1 || uris.length > MAX_REDIRECT_URIS) {
    return {
      ok: false,
      error: "invalid_redirect_uri",
      description: `redirect_uris must be an array of 1 to ${MAX_REDIRECT_URIS} strings.`,
    };
  }
  if (!uris.every(isAllowedRedirectUri)) {
    return {
      ok: false,
      error: "invalid_redirect_uri",
      description: "Redirect URIs must be https (or http on localhost) with no fragment or credentials.",
    };
  }
  const method = b.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") {
    return {
      ok: false,
      error: "invalid_client_metadata",
      description: 'Only token_endpoint_auth_method "none" is supported.',
    };
  }
  const grants = b.grant_types;
  if (
    grants !== undefined &&
    (!isStringArray(grants) || !grants.every((g) => g === "authorization_code" || g === "refresh_token"))
  ) {
    return {
      ok: false,
      error: "invalid_client_metadata",
      description: "Supported grant_types: authorization_code, refresh_token.",
    };
  }
  const responses = b.response_types;
  if (responses !== undefined && (!isStringArray(responses) || !responses.every((r) => r === "code"))) {
    return { ok: false, error: "invalid_client_metadata", description: 'Only response_types ["code"] is supported.' };
  }
  let name = DEFAULT_CLIENT_NAME;
  if (typeof b.client_name === "string") {
    const cleaned = b.client_name.replace(CONTROL_CHARS, "").trim().slice(0, MAX_CLIENT_NAME).trim();
    if (cleaned) name = cleaned;
  }
  return { ok: true, value: { name, redirectUris: [...uris] } };
}

export type AuthorizeParams = {
  clientId: string;
  redirectUri: string;
  responseType: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
  resource: string;
};

type ParamSource = { get(name: string): unknown } | Record<string, unknown>;

function pick(source: ParamSource, name: string): string {
  const v = typeof (source as { get?: unknown }).get === "function"
    ? (source as { get(n: string): unknown }).get(name)
    : (source as Record<string, unknown>)[name];
  return typeof v === "string" ? v : "";
}

/** Reads the authorize parameters from query params or posted form fields. Missing → "". */
export function readAuthorizeParams(source: ParamSource): AuthorizeParams {
  return {
    clientId: pick(source, "client_id"),
    redirectUri: pick(source, "redirect_uri"),
    responseType: pick(source, "response_type"),
    codeChallenge: pick(source, "code_challenge"),
    codeChallengeMethod: pick(source, "code_challenge_method"),
    state: pick(source, "state"),
    resource: pick(source, "resource"),
  };
}

/** Appends params to a redirect URI, keeping any query it already has. */
export function buildRedirect(base: string, params: Record<string, string | undefined>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }
  return url.toString();
}

export function sameResource(given: string, expected: string): boolean {
  return given.replace(/\/$/, "") === expected.replace(/\/$/, "");
}
