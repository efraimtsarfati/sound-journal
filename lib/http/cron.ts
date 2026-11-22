import { isCronAuthorized } from "../auth/cron";
import { resyncAllUsers, runDailyCleanup } from "../core";
import type { Db } from "../db";
import type { VectorIndex } from "../search";

/** GET /api/cron/cleanup. Checks the secret before touching the database; returns counts only. */
export async function handleCleanup(
  request: Request,
  getDb: () => Db,
  secret: string | undefined,
  now: Date = new Date(),
  index: VectorIndex | null = null,
): Promise<Response> {
  if (!isCronAuthorized(secret, request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await runDailyCleanup(getDb(), now, index);
  return Response.json({ ok: true, ...summary });
}

/** GET /api/cron/resync. Same secret check; upserts dirty highlights and sweeps stray vectors. Counts only. */
export async function handleResync(
  request: Request,
  getDb: () => Db,
  secret: string | undefined,
  index: VectorIndex | null,
): Promise<Response> {
  if (!isCronAuthorized(secret, request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!index) return Response.json({ ok: true, skipped: "vector index not configured" });
  try {
    return Response.json({ ok: true, ...(await resyncAllUsers(getDb(), index)) });
  } catch (e) {
    console.error("Search re-sync failed", e);
    return Response.json({ error: "resync_failed" }, { status: 502 });
  }
}
