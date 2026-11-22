import { z } from "zod";
import { OWNER_USER_ID, restoreEntry } from "@/lib/core";
import { getDb } from "@/lib/db";
import { syncSearchAfterResponse } from "@/lib/http/search-after";
import { coreErrorResponse } from "@/lib/http/core-error";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  try {
    const r = await restoreEntry(getDb(), OWNER_USER_ID, id.data);
    if (!r.restored) return Response.json({ error: "source_exists", conflict: r.conflict }, { status: 409 });
    syncSearchAfterResponse();
    return Response.json({ ok: true });
  } catch (e) {
    return coreErrorResponse(e);
  }
}
