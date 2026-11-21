import { OWNER_USER_ID, exportAll } from "@/lib/core";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Backup: all of the owner's rows as JSON (docs/data-model.md, Export). */
export async function GET() {
  const dump = await exportAll(getDb(), OWNER_USER_ID);
  const day = dump.exportedAt.slice(0, 10);
  return new Response(JSON.stringify(dump, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="sound-journal-export-${day}.json"`,
      "cache-control": "no-store",
    },
  });
}
