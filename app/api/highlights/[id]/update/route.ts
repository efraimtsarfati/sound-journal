import { getDb } from "@/lib/db";
import { syncSearchAfterResponse } from "@/lib/http/search-after";
import { handleUpdateHighlight } from "@/lib/http/highlight-routes";

/** Edits a highlight's note and times (session-gated by proxy.ts). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const res = await handleUpdateHighlight(req, (await ctx.params).id, getDb(), { APP_ORIGIN: process.env.APP_ORIGIN });
  syncSearchAfterResponse();
  return res;
}
