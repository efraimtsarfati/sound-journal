import { getDb } from "@/lib/db";
import { handleConfirmMatch } from "@/lib/http/match-routes";
import { syncSearchAfterResponse } from "@/lib/http/search-after";

/** Confirms the entry's waiting MusicBrainz match (session-gated by proxy.ts). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const res = await handleConfirmMatch(req, (await ctx.params).id, getDb(), { APP_ORIGIN: process.env.APP_ORIGIN });
  syncSearchAfterResponse();
  return res;
}
