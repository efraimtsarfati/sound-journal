import { z } from "zod";
import { OWNER_USER_ID, approveTag, mergeTags, rejectTag, renameTag } from "@/lib/core";
import { getDb } from "@/lib/db";
import { syncSearchAfterResponse } from "@/lib/http/search-after";
import { coreErrorResponse } from "@/lib/http/core-error";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject") }),
  z.object({ action: z.literal("rename"), name: z.string().min(1).max(200) }),
  z.object({ action: z.literal("merge"), targetId: z.uuid() }),
]);

/** The owner's decision on a tag: approve, reject, rename or merge into another tag. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await ctx.params).id);
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!id.success || !body.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const db = getDb();
  try {
    const b = body.data;
    if (b.action === "approve") await approveTag(db, OWNER_USER_ID, id.data);
    else if (b.action === "reject") await rejectTag(db, OWNER_USER_ID, id.data);
    else if (b.action === "rename") await renameTag(db, OWNER_USER_ID, id.data, b.name);
    else await mergeTags(db, OWNER_USER_ID, [id.data], b.targetId);
    syncSearchAfterResponse();
    return Response.json({ ok: true });
  } catch (e) {
    return coreErrorResponse(e);
  }
}
