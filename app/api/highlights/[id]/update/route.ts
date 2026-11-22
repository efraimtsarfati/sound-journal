import { getDb } from "@/lib/db";
import { handleUpdateHighlight } from "@/lib/http/highlight-routes";

/** Edits a highlight's note and times (session-gated by proxy.ts). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleUpdateHighlight(req, (await ctx.params).id, getDb(), { APP_ORIGIN: process.env.APP_ORIGIN });
}
