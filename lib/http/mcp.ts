import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { appOrigin } from "../auth/oauth-metadata";
import { verifyAccessToken } from "../core";
import type { Db } from "../db";
import { createMcpServer } from "../mcp/server";

export type McpEnv = { APP_ORIGIN?: string };

const NO_STORE = { "Cache-Control": "no-store" };

function bearer(header: string | null): string | null {
  const m = /^Bearer +(\S+)$/i.exec(header ?? "");
  return m ? m[1] : null;
}

function unauthorized(origin: string): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`,
      ...NO_STORE,
    },
  });
}

/**
 * POST /api/mcp: stateless streamable HTTP, JSON responses only (no SSE). A bearer access token
 * from lib/core/oauth is required; the server is built per request for the token's user.
 */
export async function handleMcp(
  req: Request,
  db: Db,
  env: McpEnv,
  deps: Parameters<typeof createMcpServer>[2] = {},
): Promise<Response> {
  const origin = appOrigin(env.APP_ORIGIN);
  if (!origin) {
    return Response.json({ error: "server_error", message: "APP_ORIGIN is not configured." }, { status: 503, headers: NO_STORE });
  }
  const token = bearer(req.headers.get("authorization"));
  const who = token ? await verifyAccessToken(db, token) : null;
  if (!who) return unauthorized(origin);

  if (req.method !== "POST") {
    // GET would open an SSE stream and DELETE ends a session; this server has neither.
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "POST", ...NO_STORE },
    });
  }

  const server = createMcpServer(db, who.userId, deps, who.clientName);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    const res = await transport.handleRequest(req);
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(res.body, { status: res.status, headers });
  } finally {
    // Stateless: nothing outlives the request.
    void transport.close();
  }
}
