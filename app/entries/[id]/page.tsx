import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionButton } from "@/app/_components/action-button";
import { StatusBadge, TagChip } from "@/app/_components/badges";
import { HighlightPlayer } from "@/app/_components/highlight-player";
import { Nav } from "@/app/_components/nav";
import { formatTime } from "@/lib/capture/time";
import { OWNER_USER_ID, getEntry } from "@/lib/core";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const view = await getEntry(getDb(), OWNER_USER_ID, id.data);
  if (!view) notFound();
  const { entry, artists, source, highlights } = view;
  const videoId = source?.type === "youtube" ? source.externalId : null;
  return (
    <main className="mx-auto max-w-xl p-4">
      <Nav />
      <h1 className="text-xl font-semibold">{entry.title}</h1>
      {artists.length > 0 && <p className="text-neutral-600">{artists.join(", ")}</p>}
      <ul className="mt-4 flex flex-col gap-4">
        {highlights.map((h) => (
          <li key={h.id} className="rounded border border-neutral-300 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono">
                {h.startSec === null
                  ? "Whole song"
                  : `${formatTime(h.startSec)}${h.endSec !== null ? `–${formatTime(h.endSec)}` : ""}`}
              </span>
              <StatusBadge status={h.status} />
            </div>
            {h.note ? (
              <p className="mt-2 whitespace-pre-wrap">{h.note}</p>
            ) : (
              <p className="mt-2 text-neutral-600">No why yet.</p>
            )}
            {h.tags.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {h.tags.map((t) => (
                  <li key={t.id} className="flex items-center gap-1">
                    <TagChip tag={t} />
                    <ActionButton
                      url={`/api/highlights/${h.id}/tags/${t.id}`}
                      method="DELETE"
                      label="×"
                      confirmText={`Remove "${t.name}" from this highlight?`}
                      className="!px-2"
                    />
                  </li>
                ))}
              </ul>
            )}
            {videoId && <HighlightPlayer videoId={videoId} startSec={h.startSec} endSec={h.endSec} />}
            {highlights.length > 1 && (
              <div className="mt-2">
                <ActionButton
                  url={`/api/highlights/${h.id}/delete`}
                  label="Delete highlight"
                  confirmText="Delete this highlight?"
                />
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap gap-3">
        {source && (
          <Link
            href={`/capture?url=${encodeURIComponent(source.url)}`}
            className="inline-flex min-h-11 items-center rounded border border-neutral-400 px-4 font-medium"
          >
            Add a highlight
          </Link>
        )}
        <ActionButton
          url={`/api/entries/${entry.id}/delete`}
          label="Delete entry"
          confirmText="Delete this entry and its highlights? You can restore it from Deleted for 30 days."
        />
      </div>
    </main>
  );
}
