import { getDb } from "@/lib/db";
import { handleAddHighlight } from "@/lib/http/highlight-routes";

/** Adds a highlight to an entry (session-gated by proxy.ts). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleAddHighlight(req, (await ctx.params).id, getDb(), { APP_ORIGIN: process.env.APP_ORIGIN });
}
