import { getDb } from "@/lib/db";
import { handleResync } from "@/lib/http/cron";
import { getVectorIndex } from "@/lib/search";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleResync(request, getDb, process.env.CRON_SECRET, getVectorIndex());
}
