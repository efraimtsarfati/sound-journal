import { OWNER_USER_ID, resyncSearch } from "../core";
import type { Db } from "../db";
import type { VectorIndex } from "../search";
import type { SessionEnv } from "./connector-routes";
import { checkSessionRequest } from "./session-request";

/** The settings page's "Re-sync search" button (session-gated by proxy.ts; Origin checked here). */
export async function handleManualResync(request: Request, db: Db, env: SessionEnv, index: VectorIndex | null): Promise<Response> {
  const refused = checkSessionRequest(request, env, { json: false });
  if (refused) return refused;
  if (!index) {
    return Response.json({ error: "not_configured", message: "The search index isn't configured." }, { status: 400 });
  }
  try {
    return Response.json({ ok: true, ...(await resyncSearch(db, index, OWNER_USER_ID)) });
  } catch (e) {
    console.error("Manual search re-sync failed", e);
    return Response.json({ error: "resync_failed", message: "Couldn't reach the search index. Try again." }, { status: 502 });
  }
}
