import Link from "next/link";
import { Nav } from "./_components/nav";
import { StatusBadge, TagChip } from "./_components/badges";
import { OWNER_USER_ID, inboxCounts, listEntries } from "@/lib/core";
import { getDb } from "@/lib/db";
import { formatTime } from "@/lib/capture/time";

export const dynamic = "force-dynamic";

/** In the "needs a why" view, an entry opens its first such clip already in edit mode. */
function entryHref(id: string, hs: { id: string; status: string }[], status?: string) {
  const w = status === "needs_why" ? hs.find((h) => h.status === "needs_why") : undefined;
  return `/entries/${id}${w ? `?edit=${w.id}` : ""}`;
}

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.slice(0, 100) ?? "";
  };
  const status = ["needs_why", "needs_tags", "tagged"].includes(one("status"))
    ? (one("status") as "needs_why" | "needs_tags" | "tagged")
    : undefined;
  const filters = { q: one("q"), artist: one("artist"), tag: one("tag"), axis: one("axis"), status };
  const filtering = Object.values(filters).some(Boolean);
  const db = getDb();
  const [counts, list] = await Promise.all([
    inboxCounts(db, OWNER_USER_ID),
    listEntries(db, OWNER_USER_ID, { limit: 100, ...filters }),
  ]);
  const field = "min-h-11 w-full rounded border border-neutral-300 px-2";
  return (
    <main className="mx-auto max-w-xl p-4">
      <h1 className="text-xl font-semibold">Sound Journal</h1>
      <Nav />
      <p className="rounded bg-neutral-100 p-3 text-sm" data-testid="inbox-counts">
        {counts.needsWhy === 0 && counts.needsTags === 0
          ? "Inbox is clear."
          : `${counts.needsWhy} need a why, ${counts.needsTags} need tags.`}
        {counts.needsWhy > 0 && (
          <>
            {" "}
            <Link href="/?status=needs_why" className="inline-flex min-h-11 items-center font-medium underline">
              Add a why
            </Link>
          </>
        )}
      </p>
      <form method="get" action="/" className="mt-4 flex flex-col gap-2" role="search">
        <input name="q" defaultValue={filters.q} placeholder="Search title, artist, album" aria-label="Search" className={field} />
        <div className="grid grid-cols-2 gap-2">
          <input name="artist" defaultValue={filters.artist} placeholder="Artist" aria-label="Artist" className={field} />
          <input name="tag" defaultValue={filters.tag} placeholder="Tag" aria-label="Tag" className={field} />
          <input name="axis" defaultValue={filters.axis} placeholder="Axis" aria-label="Axis" className={field} />
          <select name="status" defaultValue={status ?? ""} aria-label="Status" className={field}>
            <option value="">Any status</option>
            <option value="needs_why">Needs a why</option>
            <option value="needs_tags">Needs tags</option>
            <option value="tagged">Tagged</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button type="submit" className="min-h-11 rounded bg-neutral-900 px-4 text-white">
            Search
          </button>
          {filtering && (
            <Link href="/" className="flex min-h-11 items-center px-3 underline">
              Clear
            </Link>
          )}
        </div>
      </form>
      {list.length === 0 && filtering ? (
        <p className="mt-6 text-neutral-600">No entries match.</p>
      ) : list.length === 0 ? (
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
              <Link href={entryHref(entry.id, highlights, status)} className="block min-h-11 p-3">
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
