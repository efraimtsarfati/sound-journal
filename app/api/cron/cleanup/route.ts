import { getDb } from "@/lib/db";
import { handleCleanup } from "@/lib/http/cron";
import { getVectorIndex } from "@/lib/search";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleCleanup(request, getDb, process.env.CRON_SECRET, new Date(), getVectorIndex());
}
