import Link from "next/link";
import { Nav } from "./_components/nav";
import { StatusBadge, TagChip } from "./_components/badges";
import { OWNER_USER_ID, inboxCounts, listEntries } from "@/lib/core";
import { getDb } from "@/lib/db";
import { formatTime } from "@/lib/capture/time";

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = getDb();
  const [counts, list] = await Promise.all([
    inboxCounts(db, OWNER_USER_ID),
    listEntries(db, OWNER_USER_ID, { limit: 100 }),
  ]);
  return (
    <main className="mx-auto max-w-xl p-4">
      <h1 className="text-xl font-semibold">Sound Journal</h1>
      <Nav />
      <p className="rounded bg-neutral-100 p-3 text-sm" data-testid="inbox-counts">
        {counts.needsWhy === 0 && counts.needsTags === 0
          ? "Inbox is clear."
          : `${counts.needsWhy} need a why, ${counts.needsTags} need tags.`}
      </p>
      {list.length === 0 ? (
        <p className="mt-6 text-neutral-600">
          Nothing saved yet.{" "}
          <Link href="/capture" className="underline">
            Capture your first moment.
          </Link>
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {list.map(({ entry, artists, highlights }) => (
            <li key={entry.id} className="rounded border border-neutral-300">
              <Link href={`/entries/${entry.id}`} className="block min-h-11 p-3">
                <span className="block font-medium">{entry.title}</span>
                {artists.length > 0 && <span className="block text-sm text-neutral-600">{artists.join(", ")}</span>}
                <ul className="mt-2 flex flex-col gap-2">
                  {highlights.map((h) => (
                    <li key={h.id} className="text-sm">
                      <span className="mr-2 font-mono text-neutral-600">
                        {h.startSec === null ? "whole" : formatTime(h.startSec)}
                      </span>
                      <StatusBadge status={h.status} />
                      {h.note && <span className="mt-1 block text-neutral-800">{h.note}</span>}
                      {h.tags.length > 0 && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {h.tags.map((t) => (
                            <TagChip key={t.id} tag={t} />
                          ))}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
