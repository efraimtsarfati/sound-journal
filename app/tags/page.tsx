import { Nav } from "@/app/_components/nav";
import { OWNER_USER_ID, listApprovedTags, listProposedTags } from "@/lib/core";
import { getDb } from "@/lib/db";
import { TagRow } from "./tag-row";

export const metadata = { title: "Tags · Sound Journal" };
export const dynamic = "force-dynamic";

export default async function TagsPage() {
  const db = getDb();
  const [proposed, approved] = await Promise.all([
    listProposedTags(db, OWNER_USER_ID),
    listApprovedTags(db, OWNER_USER_ID),
  ]);
  return (
    <main className="mx-auto max-w-xl p-4">
      <h1 className="text-xl font-semibold">Tag review</h1>
      <Nav />
      {proposed.length === 0 ? (
        <p className="text-neutral-600">No proposed tags waiting for a decision.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {proposed.map((t) => (
            <TagRow
              key={t.id}
              id={t.id}
              name={t.name}
              axis={t.axis}
              uses={t.uses}
              targets={approved.filter((a) => a.axis === t.axis).map((a) => ({ id: a.id, name: a.name }))}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
