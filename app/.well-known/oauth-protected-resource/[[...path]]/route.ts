import { preflight } from "@/lib/http/cors";
import { handleProtectedResourceMetadata } from "@/lib/http/discovery";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params;
  return handleProtectedResourceMetadata(process.env.APP_ORIGIN, path);
}
export function OPTIONS() {
  return preflight();
}
