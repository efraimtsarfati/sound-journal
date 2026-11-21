"use client";

import { useState } from "react";
import { formatTime } from "@/lib/capture/time";

/** Plays a highlight in place, starting (and stopping) at its timestamps. Always offers a link out to YouTube. */
export function HighlightPlayer({
  videoId,
  startSec,
  endSec,
}: {
  videoId: string;
  startSec: number | null;
  endSec: number | null;
}) {
  const [open, setOpen] = useState(false);
  const at = startSec !== null ? ` at ${formatTime(startSec)}` : "";
  const params = new URLSearchParams({ autoplay: "1", playsinline: "1" });
  if (startSec !== null) params.set("start", String(startSec));
  if (endSec !== null) params.set("end", String(endSec));
  const watch = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}${startSec !== null ? `&t=${startSec}s` : ""}`;
  return (
    <div className="mt-2">
      {open ? (
        <div className="aspect-video w-full overflow-hidden rounded bg-black">
          <iframe
            className="h-full w-full"
            src={`https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params}`}
            title="YouTube player"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-11 min-w-11 rounded bg-neutral-900 px-4 font-medium text-white"
        >
          Play{at}
        </button>
      )}
      <a
        href={watch}
        target="_blank"
        rel="noreferrer"
        className="ml-3 inline-flex min-h-11 items-center text-sm underline"
      >
        Open on YouTube{at}
      </a>
    </div>
  );
}
