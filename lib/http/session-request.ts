import { appOrigin } from "../auth/oauth-metadata";

/**
 * Guards a session-cookie route that changes state (defense in depth beside SameSite=Lax):
 * the request's Origin, when sent, must be the app's own origin (APP_ORIGIN), and a route with a
 * JSON body must be sent as `application/json` (which a cross-site HTML form cannot do).
 * Returns the refusal to send, or null when the request may proceed. Fails closed without APP_ORIGIN.
 */
export function checkSessionRequest(
  request: Request,
  env: { APP_ORIGIN?: string },
  opts: { json: boolean },
): Response | null {
  const origin = appOrigin(env.APP_ORIGIN);
  if (!origin) {
    return Response.json({ error: "server_error", message: "APP_ORIGIN is not configured." }, { status: 503 });
  }
  const sent = request.headers.get("origin");
  if (sent !== null && sent !== origin) {
    return Response.json({ error: "forbidden", message: "Cross-origin request." }, { status: 403 });
  }
  if (opts.json) {
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") {
      return Response.json({ error: "invalid_input", message: "Send the body as application/json." }, { status: 415 });
    }
  }
  return null;
}
