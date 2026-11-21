import { z } from "zod";
import { OWNER_USER_ID, lookupYouTube } from "@/lib/core";
import { getDb } from "@/lib/db";

const Body = z.object({ url: z.string().min(1).max(2000) });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const result = await lookupYouTube(getDb(), OWNER_USER_ID, parsed.data.url);
  if (!result.ok) {
    const status = result.error === "unavailable" ? 502 : result.error === "not_found" ? 404 : 400;
    return Response.json(result, { status });
  }
  return Response.json(result);
}
