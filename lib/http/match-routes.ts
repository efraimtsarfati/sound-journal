import { z } from "zod";
import { OWNER_USER_ID, confirmMatch, rejectMatchCandidate } from "../core";
import type { Db } from "../db";
import type { MusicBrainzDeps } from "../metadata/musicbrainz";
import { coreErrorResponse } from "./core-error";
import type { SessionEnv } from "./connector-routes";
import { checkSessionRequest } from "./session-request";

function guard(request: Request, env: SessionEnv, id: string) {
  const refused = checkSessionRequest(request, env, { json: false });
  if (refused) return { response: refused, id: null };
  const uuid = z.uuid().safeParse(id);
  if (!uuid.success) return { response: Response.json({ error: "invalid_input", message: "Invalid input." }, { status: 400 }), id: null };
  return { response: null, id: uuid.data };
}

/** The user confirms the entry's waiting MusicBrainz candidate (session-gated by proxy.ts). */
export async function handleConfirmMatch(request: Request, entryId: string, db: Db, env: SessionEnv, mb: MusicBrainzDeps = {}): Promise<Response> {
  const g = guard(request, env, entryId);
  if (g.response) return g.response;
  try {
    const r = await confirmMatch(db, OWNER_USER_ID, g.id, mb);
    return Response.json({ ok: true, entryId: r.entry.id, matchStatus: r.entry.matchStatus });
  } catch (e) {
    return coreErrorResponse(e);
  }
}

/** The user says the candidate is wrong; it is dropped and the entry stays unmatched. */
export async function handleRejectMatch(request: Request, entryId: string, db: Db, env: SessionEnv): Promise<Response> {
  const g = guard(request, env, entryId);
  if (g.response) return g.response;
  try {
    const entry = await rejectMatchCandidate(db, OWNER_USER_ID, g.id);
    return Response.json({ ok: true, entryId: entry.id, matchStatus: entry.matchStatus });
  } catch (e) {
    return coreErrorResponse(e);
  }
}
