import { Nav } from "@/app/_components/nav";
import { OWNER_USER_ID, listDeletedEntries } from "@/lib/core";
import { getDb } from "@/lib/db";
import { DeletedRow } from "./deleted-row";

export const metadata = { title: "Deleted · Sound Journal" };
export const dynamic = "force-dynamic";

export default async function DeletedPage() {
  const list = await listDeletedEntries(getDb(), OWNER_USER_ID);
  return (
    <main className="mx-auto max-w-xl p-4">
      <h1 className="text-xl font-semibold">Deleted</h1>
      <Nav />
      <p className="mb-3 text-sm text-neutral-600">Deleted entries are kept for 30 days, then removed for good.</p>
      {list.length === 0 ? (
        <p className="text-neutral-600">Nothing deleted.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((v) => (
            <DeletedRow key={v.entry.id} id={v.entry.id} title={v.entry.title} highlightCount={v.highlights.length} />
          ))}
        </ul>
      )}
    </main>
  );
}
