import { z } from "zod";
import { OWNER_USER_ID, revokeConnectedApp } from "@/lib/core";
import { getDb } from "@/lib/db";
import { coreErrorResponse } from "@/lib/http/core-error";

/** Revokes a connected app: its tokens stop working immediately (session-gated by proxy.ts). */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return Response.json({ error: "invalid_input", message: "Invalid id." }, { status: 400 });
  try {
    await revokeConnectedApp(getDb(), OWNER_USER_ID, id.data);
    return Response.json({ ok: true });
  } catch (e) {
    return coreErrorResponse(e);
  }
}
