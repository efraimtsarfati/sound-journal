import { z } from "zod";
import { OWNER_USER_ID, addHighlight, updateHighlight } from "../core";
import type { Db } from "../db";
import { coreErrorResponse } from "./core-error";
import { checkSessionRequest } from "./session-request";
import type { SessionEnv } from "./connector-routes";

const Times = {
  startSec: z.number().int().min(0).nullable().optional(),
  endSec: z.number().int().min(1).nullable().optional(),
  note: z.string().max(10000).nullable().optional(),
};
const Body = z.object(Times).strict();

async function parse(request: Request, env: SessionEnv, id: string) {
  const refused = checkSessionRequest(request, env, { json: true });
  if (refused) return { response: refused, id: null, body: null };
  const uuid = z.uuid().safeParse(id);
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!uuid.success || !body.success) {
    return { response: Response.json({ error: "invalid_input", message: "Invalid input." }, { status: 400 }), id: null, body: null };
  }
  return { response: null, id: uuid.data, body: body.data };
}

/** Edits a highlight's note and/or times (session-gated by proxy.ts). Status follows data-model's highlight workflow. */
export async function handleUpdateHighlight(request: Request, id: string, db: Db, env: SessionEnv): Promise<Response> {
  const p = await parse(request, env, id);
  if (p.response) return p.response;
  try {
    const h = await updateHighlight(db, OWNER_USER_ID, p.id, p.body);
    return Response.json({ ok: true, highlightId: h.id, status: h.status });
  } catch (e) {
    return coreErrorResponse(e);
  }
}

/** Adds a highlight to an existing entry; a note is never required (session-gated by proxy.ts). */
export async function handleAddHighlight(request: Request, entryId: string, db: Db, env: SessionEnv): Promise<Response> {
  const p = await parse(request, env, entryId);
  if (p.response) return p.response;
  try {
    const h = await addHighlight(db, OWNER_USER_ID, p.id, p.body);
    return Response.json({ ok: true, highlightId: h.id, status: h.status });
  } catch (e) {
    return coreErrorResponse(e);
  }
}
