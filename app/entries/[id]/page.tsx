
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionButton } from "@/app/_components/action-button";
import { Nav } from "@/app/_components/nav";
import { SongClips } from "./song-clips";
import { OWNER_USER_ID, getEntry } from "@/lib/core";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function EntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string | string[] }>;
}) {
  const edit = (await searchParams).edit;
  const editId = typeof edit === "string" && z.uuid().safeParse(edit).success ? edit : null;
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
      <SongClips entryId={entry.id} videoId={videoId} clips={highlights.map((h) => ({ id: h.id, startSec: h.startSec, endSec: h.endSec, note: h.note, status: h.status, tags: h.tags.map((t) => ({ id: t.id, name: t.name, axis: t.axis, state: t.state })) }))} editId={editId} />
      <div className="mt-6 flex flex-wrap gap-3">
        <ActionButton
          url={`/api/entries/${entry.id}/delete`}
          label="Delete entry"
          confirmText="Delete this entry and its highlights? You can restore it from Deleted for 30 days."
        />
      </div>
    </main>
  );
}
