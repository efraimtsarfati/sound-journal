import { isCronAuthorized } from "../auth/cron";
import { runDailyCleanup } from "../core";
import type { Db } from "../db";

/** GET /api/cron/cleanup. Checks the secret before touching the database; returns counts only. */
export async function handleCleanup(
  request: Request,
  getDb: () => Db,
  secret: string | undefined,
  now: Date = new Date(),
): Promise<Response> {
  if (!isCronAuthorized(secret, request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await runDailyCleanup(getDb(), now);
  return Response.json({ ok: true, ...summary });
}
