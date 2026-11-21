import { appOrigin, authorizationServerMetadata, protectedResourceMetadata } from "../auth/oauth-metadata";
import { withCors } from "./cors";

const CACHE = { "Cache-Control": "public, max-age=300" };

function unconfigured(): Response {
  return withCors(
    Response.json(
      { error: "server_error", error_description: "APP_ORIGIN is not configured." },
      { status: 503 },
    ),
  );
}

export function handleAuthorizationServerMetadata(appOriginEnv: string | undefined): Response {
  const origin = appOrigin(appOriginEnv);
  if (!origin) return unconfigured();
  return withCors(Response.json(authorizationServerMetadata(origin), { headers: CACHE }));
}

/** Serves `/.well-known/oauth-protected-resource` and the `/api/mcp` path form; other sub-paths 404. */
export function handleProtectedResourceMetadata(
  appOriginEnv: string | undefined,
  path: string[] | undefined,
): Response {
  const joined = (path ?? []).join("/");
  if (joined !== "" && joined !== "api/mcp") {
    return withCors(Response.json({ error: "not_found" }, { status: 404 }));
  }
  const origin = appOrigin(appOriginEnv);
  if (!origin) return unconfigured();
  return withCors(Response.json(protectedResourceMetadata(origin), { headers: CACHE }));
}
