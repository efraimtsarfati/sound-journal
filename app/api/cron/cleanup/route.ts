import { getDb } from "@/lib/db";
import { handleCleanup } from "@/lib/http/cron";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleCleanup(request, getDb, process.env.CRON_SECRET);
}
