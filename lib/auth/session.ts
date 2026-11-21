import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "sj_session";
export const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** `<expiresAtSec>.<hmac>`; stateless, so logout just clears the cookie. */
export function createSessionToken(secret: string, nowMs: number = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + SESSION_MAX_AGE_SEC;
  return `${exp}.${sign(secret, `v1.${exp}`)}`;
}

export function verifySessionToken(
  secret: string | undefined,
  token: string | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!secret || !token) return false;
  const [expStr, mac, extra] = token.split(".");
  if (!expStr || !mac || extra !== undefined || !/^\d+$/.test(expStr)) return false;
  if (Number(expStr) <= Math.floor(nowMs / 1000)) return false;
  const expected = Buffer.from(sign(secret, `v1.${expStr}`));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Paths that skip the session check because they authenticate themselves (see architecture → Authentication). */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/api/health" ||
    pathname === "/oauth/authorize" ||
    pathname === "/api/mcp" ||
    pathname.startsWith("/api/mcp/") ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/.well-known/") ||
    pathname.startsWith("/api/oauth/") ||
    pathname.startsWith("/api/cron/")
  );
}

/** Only same-site relative paths; anything else becomes "/". */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  // Control chars (tab/LF/CR are stripped by the WHATWG URL parser) and backslashes can turn a
  // "local" path into a protocol-relative URL.
  if (/[\x00-\x1f\x7f\\]/.test(next)) return "/";
  try {
    const base = "http://local.invalid";
    if (new URL(next, base).origin !== base) return "/";
  } catch {
    return "/";
  }
  return next;
}
