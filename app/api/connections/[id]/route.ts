import { getDb } from "@/lib/db";
import { handleRevokeConnection } from "@/lib/http/connector-routes";

/** Revokes a connected app (session-gated by proxy.ts). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleRevokeConnection(req, (await ctx.params).id, getDb(), { APP_ORIGIN: process.env.APP_ORIGIN });
}
