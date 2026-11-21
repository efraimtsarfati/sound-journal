import { z } from "zod";
import { OWNER_USER_ID, setConnectorSwitches } from "@/lib/core";
import { getDb } from "@/lib/db";
import { coreErrorResponse } from "@/lib/http/core-error";

const Body = z
  .object({ enabled: z.boolean(), allowChanges: z.boolean(), allowDeletes: z.boolean() })
  .partial()
  .strict();

/** Sets one or more connector switches (session-gated by proxy.ts). */
export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid_input", message: "Invalid switch values." }, { status: 400 });
  try {
    await setConnectorSwitches(getDb(), OWNER_USER_ID, body.data);
    return Response.json({ ok: true });
  } catch (e) {
    return coreErrorResponse(e);
  }
}
