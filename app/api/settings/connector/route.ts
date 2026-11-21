import { getDb } from "@/lib/db";
import { handleConnectorSwitches } from "@/lib/http/connector-routes";

/** Sets one or more connector switches (session-gated by proxy.ts). */
export async function POST(req: Request) {
  return handleConnectorSwitches(req, getDb(), { APP_ORIGIN: process.env.APP_ORIGIN });
}
