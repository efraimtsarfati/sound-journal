import { z } from "zod";
import { OWNER_USER_ID, moveDeletedHighlightsToLiveEntry } from "@/lib/core";
import { getDb } from "@/lib/db";
import { coreErrorResponse } from "@/lib/http/core-error";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  try {
    const r = await moveDeletedHighlightsToLiveEntry(getDb(), OWNER_USER_ID, id.data);
    return Response.json({ ok: true, ...r });
  } catch (e) {
    return coreErrorResponse(e);
  }
}
