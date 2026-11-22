import { getDb } from "@/lib/db";
import { handleManualResync } from "@/lib/http/search-routes";
import { getVectorIndex } from "@/lib/search";

export const dynamic = "force-dynamic";

/** Re-syncs the search index from Postgres (session-gated by proxy.ts). */
export function POST(request: Request) {
  return handleManualResync(request, getDb(), { APP_ORIGIN: process.env.APP_ORIGIN }, getVectorIndex());
}
