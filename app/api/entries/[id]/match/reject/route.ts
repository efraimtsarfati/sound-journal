import { getDb } from "@/lib/db";
import { handleRejectMatch } from "@/lib/http/match-routes";

/** Drops the entry's waiting MusicBrainz candidate (session-gated by proxy.ts). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleRejectMatch(req, (await ctx.params).id, getDb(), { APP_ORIGIN: process.env.APP_ORIGIN });
}
