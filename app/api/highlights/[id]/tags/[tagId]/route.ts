import { z } from "zod";
import { OWNER_USER_ID, removeTagFromHighlight } from "@/lib/core";
import { getDb } from "@/lib/db";
import { coreErrorResponse } from "@/lib/http/core-error";
import { syncSearchAfterResponse } from "@/lib/http/search-after";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; tagId: string }> }) {
  const p = z.object({ id: z.uuid(), tagId: z.uuid() }).safeParse(await ctx.params);
  if (!p.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  try {
    await removeTagFromHighlight(getDb(), OWNER_USER_ID, p.data.id, p.data.tagId);
    syncSearchAfterResponse();
    return Response.json({ ok: true });
  } catch (e) {
    return coreErrorResponse(e);
  }
}
