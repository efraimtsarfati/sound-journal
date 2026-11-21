import { getDb } from "@/lib/db";
import { handleMcp } from "@/lib/http/mcp";

export const dynamic = "force-dynamic";

const handler = (request: Request) => handleMcp(request, getDb(), { APP_ORIGIN: process.env.APP_ORIGIN });

export { handler as GET, handler as POST, handler as DELETE };
