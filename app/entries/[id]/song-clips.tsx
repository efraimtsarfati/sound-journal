"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ActionButton } from "@/app/_components/action-button";
import { StatusBadge, TagChip } from "@/app/_components/badges";
import { TimeRow } from "@/app/_components/time-row";
import { loadYouTubeApi, type YTPlayer } from "@/app/_components/youtube-api";
import { formatTime, parseTime } from "@/lib/capture/time";

export type ClipView = {
  id: string;
  startSec: number | null;
  endSec: number | null;
  note: string | null;
  status: string;
  tags: { id: string; name: string; axis: string; state: string }[];
};

const btn = "min-h-11 min-w-11 rounded px-4 font-medium";
const secondary = `${btn} border border-neutral-400 bg-white`;
const primary = `${btn} bg-neutral-900 text-white disabled:opacity-50`;

function range(c: Pick<ClipView, "startSec" | "endSec">) {
  return c.startSec === null ? "Whole song" : `${formatTime(c.startSec)}${c.endSec !== null ? `–${formatTime(c.endSec)}` : ""}`;
}

export function SongClips({
  entryId,
  videoId,
  clips,
  editId,
}: {
  entryId: string;
  videoId: string | null;
  clips: ClipView[];
  /** A clip to open already in edit mode (from the inbox link). */
  editId: string | null;
}) {
  const playerEl = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<string | null>(clips.some((c) => c.id === editId) ? editId : null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!videoId || !playerEl.current) return;
    let cancelled = false;
    const host = playerEl.current;
    const mount = document.createElement("div");
    host.appendChild(mount);
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        player.current = new YT.Player(mount, {
          videoId,
          playerVars: { playsinline: 1 },
          events: { onError: () => setFailed(true) },
        });
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      try {
        player.current?.destroy();
      } catch {
        /* player already gone */
      }
      player.current = null;
      host.replaceChildren();
    };
  }, [videoId]);

  const showPlayer = !!videoId && !failed;
  const watch = (sec: number | null) =>
    `https://www.youtube.com/watch?v=${encodeURIComponent(videoId ?? "")}${sec ? `&t=${sec}s` : ""}`;

  function playFrom(sec: number | null) {
    const p = player.current;
    if (!p?.seekTo || !p.playVideo) {
      window.open(watch(sec), "_blank", "noopener,noreferrer");
      return;
    }
    p.seekTo(sec ?? 0, true);
    p.playVideo();
  }

  function currentTime(): number | null {
    const t = player.current?.getCurrentTime();
    return typeof t === "number" ? t : null;
  }

  return (
    <>
      {videoId ? (
        showPlayer ? (
          <div className="sticky top-0 z-10 mt-3 aspect-video w-full overflow-hidden rounded bg-black [&_iframe]:h-full [&_iframe]:w-full">
            <div ref={playerEl} className="h-full w-full" />
          </div>
        ) : (
          <p className="mt-3 rounded bg-neutral-100 p-3 text-sm">
            This video can&apos;t be played here.{" "}
            <a href={watch(null)} target="_blank" rel="noopener noreferrer" className="font-medium underline">
              Open it on YouTube
            </a>
            ; type times by hand.
          </p>
        )
      ) : null}
      <ul className="mt-4 flex flex-col gap-4">
        {clips.map((c) => (
          <li key={c.id} id={`clip-${c.id}`} className="rounded border border-neutral-300 p-3">
            {editing === c.id ? (
              <ClipEditor
                clip={c}
                entryId={entryId}
                canMark={showPlayer}
                currentTime={currentTime}
                canDelete={clips.length > 1}
                onDone={() => setEditing(null)}
              />
            ) : (
              <ClipCard
                clip={c}
                onPlay={() => playFrom(c.startSec)}
                canPlay={!!videoId}
                watchHref={videoId ? watch(c.startSec) : null}
                onEdit={() => {
                  setAdding(false);
                  setEditing(c.id);
                }}
              />
            )}
          </li>
        ))}
        {adding ? (
          <li className="rounded border border-neutral-300 p-3">
            <ClipEditor
              clip={null}
              entryId={entryId}
              canMark={showPlayer}
              currentTime={currentTime}
              canDelete={false}
              onDone={() => setAdding(false)}
            />
          </li>
        ) : null}
      </ul>
      {!adding ? (
        <div className="mt-4">
          <button
            type="button"
            className={secondary}
            onClick={() => {
              setEditing(null);
              setAdding(true);
            }}
          >
            Add a clip
          </button>
        </div>
      ) : null}
    </>
  );
}

function ClipCard({
  clip,
  onPlay,
  canPlay,
  watchHref,
  onEdit,
}: {
  clip: ClipView;
  onPlay: () => void;
  canPlay: boolean;
  watchHref: string | null;
  onEdit: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {canPlay ? (
          <button type="button" onClick={onPlay} className="min-h-11 min-w-11 rounded font-mono underline" aria-label={`Play from ${range(clip)}`}>
            {range(clip)}
          </button>
        ) : (
          <span className="font-mono">{range(clip)}</span>
        )}
        <StatusBadge status={clip.status} />
        {watchHref ? (
          <a href={watchHref} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm underline">
            YouTube
          </a>
        ) : null}
      </div>
      {clip.note ? <p className="mt-2 whitespace-pre-wrap">{clip.note}</p> : <p className="mt-2 text-neutral-600">No why yet.</p>}
      {clip.tags.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {clip.tags.map((t) => (
            <li key={t.id} className="flex items-center gap-1">
              <TagChip tag={t as Parameters<typeof TagChip>[0]["tag"]} />
              <ActionButton
                url={`/api/highlights/${clip.id}/tags/${t.id}`}
                method="DELETE"
                label="×"
                confirmText={`Remove "${t.name}" from this highlight?`}
                className="!px-2"
              />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2">
        <button type="button" className={secondary} onClick={onEdit}>
          Edit
        </button>
      </div>
    </>
  );
}

function ClipEditor({
  clip,
  entryId,
  canMark,
  currentTime,
  canDelete,
  onDone,
}: {
  clip: ClipView | null;
  entryId: string;
  canMark: boolean;
  currentTime: () => number | null;
  canDelete: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const key = clip?.id ?? "new";
  const [note, setNote] = useState(clip?.note ?? "");
  const [start, setStart] = useState(clip?.startSec != null ? formatTime(clip.startSec) : "");
  const [end, setEnd] = useState(clip?.endSec != null ? formatTime(clip.endSec) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startSec = parseTime(start);
  const endSec = parseTime(end);
  const startBad = start.trim() !== "" && startSec === null;
  const endBad = end.trim() !== "" && endSec === null;
  const endNeedsStart = endSec !== null && startSec === null;
  const endBeforeStart = endSec !== null && startSec !== null && endSec <= startSec;
  const invalid = startBad || endBad || endNeedsStart || endBeforeStart;

  function mark(set: (v: string) => void) {
    const t = currentTime();
    if (t !== null) set(formatTime(t));
  }

  async function save() {
    if (invalid) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(clip ? `/api/highlights/${clip.id}/update` : `/api/entries/${entryId}/highlights`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startSec, endSec, note: note.trim() === "" ? null : note }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? "Couldn't save. Your changes are still here; try again.");
        return;
      }
      onDone();
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Your changes are still here; try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label htmlFor={`note-${key}`} className="text-sm font-medium">
          Why does it move you? (optional)
        </label>
        <textarea
          id={`note-${key}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          autoFocus={clip?.status === "needs_why"}
          className="mt-1 w-full rounded border border-neutral-400 p-3"
        />
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Moment</legend>
        <TimeRow
          id={`start-${key}`}
          label="Start"
          value={start}
          onChange={setStart}
          bad={startBad}
          onMark={canMark ? () => mark(setStart) : undefined}
          onClear={() => setStart("")}
        />
        <TimeRow
          id={`end-${key}`}
          label="End"
          value={end}
          onChange={setEnd}
          bad={endBad || endNeedsStart || endBeforeStart}
          onMark={canMark ? () => mark(setEnd) : undefined}
          onClear={() => setEnd("")}
        />
        {endNeedsStart ? <p className="text-sm text-red-700">An end time needs a start time.</p> : null}
        {endBeforeStart ? <p className="text-sm text-red-700">End must be after start.</p> : null}
        {startBad || endBad ? <p className="text-sm text-red-700">Use m:ss, like 1:15.</p> : null}
        <p className="text-sm text-neutral-600">Leave both empty for the whole song.</p>
      </fieldset>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void save()} disabled={saving || invalid} className={primary}>
          {saving ? "Saving" : "Save"}
        </button>
        <button type="button" onClick={onDone} disabled={saving} className={secondary}>
          Cancel
        </button>
        {clip && canDelete ? (
          <ActionButton url={`/api/highlights/${clip.id}/delete`} label="Delete" confirmText="Delete this clip?" />
        ) : null}
      </div>
    </div>
  );
}
