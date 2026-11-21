import { getDb } from "@/lib/db";
import { preflight } from "@/lib/http/cors";
import { handleRegister } from "@/lib/http/oauth";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleRegister(request, getDb());
}
export function OPTIONS() {
  return preflight();
}
