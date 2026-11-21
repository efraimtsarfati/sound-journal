import { CoreError } from "@/lib/core";

/** Maps a rule violation from lib/core to a JSON response; anything else is rethrown. */
export function coreErrorResponse(e: unknown): Response {
  if (!(e instanceof CoreError)) throw e;
  const status = e.code === "not_found" ? 404 : e.code === "invalid_state" || e.code === "tag_conflict" ? 409 : 400;
  return Response.json({ error: e.code, message: e.message }, { status });
}
