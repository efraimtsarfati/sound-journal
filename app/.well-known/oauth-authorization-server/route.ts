import { preflight } from "@/lib/http/cors";
import { handleAuthorizationServerMetadata } from "@/lib/http/discovery";

export const dynamic = "force-dynamic";

export function GET() {
  return handleAuthorizationServerMetadata(process.env.APP_ORIGIN);
}
export function OPTIONS() {
  return preflight();
}
