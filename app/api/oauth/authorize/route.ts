import { getDb } from "@/lib/db";
import { handleConsent } from "@/lib/http/oauth";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleConsent(request, getDb(), {
    APP_ORIGIN: process.env.APP_ORIGIN,
    APP_PASSWORD: process.env.APP_PASSWORD,
  });
}
