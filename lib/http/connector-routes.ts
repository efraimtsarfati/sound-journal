import { z } from "zod";
import { OWNER_USER_ID, revokeConnectedApp, setConnectorSwitches } from "../core";
import type { Db } from "../db";
import { coreErrorResponse } from "./core-error";
import { checkSessionRequest } from "./session-request";

export type SessionEnv = { APP_ORIGIN?: string };

const Body = z
  .object({ enabled: z.boolean(), allowChanges: z.boolean(), allowDeletes: z.boolean() })
  .partial()
  .strict();

/** Sets one or more connector switches (session-gated by proxy.ts; Origin and content type checked here). */
export async function handleConnectorSwitches(request: Request, db: Db, env: SessionEnv): Promise<Response> {
  const refused = checkSessionRequest(request, env, { json: true });
  if (refused) return refused;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid_input", message: "Invalid switch values." }, { status: 400 });
  try {
    await setConnectorSwitches(db, OWNER_USER_ID, body.data);
    return Response.json({ ok: true });
  } catch (e) {
    return coreErrorResponse(e);
  }
}

/** Revokes a connected app: its tokens stop working immediately (session-gated by proxy.ts). */
export async function handleRevokeConnection(request: Request, id: string, db: Db, env: SessionEnv): Promise<Response> {
  const refused = checkSessionRequest(request, env, { json: false });
  if (refused) return refused;
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return Response.json({ error: "invalid_input", message: "Invalid id." }, { status: 400 });
  try {
    await revokeConnectedApp(db, OWNER_USER_ID, parsed.data);
    return Response.json({ ok: true });
  } catch (e) {
    return coreErrorResponse(e);
  }
}
