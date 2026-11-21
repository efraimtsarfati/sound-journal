"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatTime, parseTime } from "@/lib/capture/time";

type Lookup = {
  ok: true;
  videoId: string;
  startSec: number | null;
  watchUrl: string;
  embeddable: boolean;
  rawTitle: string | null;
  rawChannel: string | null;
  title: string;
  artist: string | null;
  duplicate: { id: string; title: string } | null;
};

type YTPlayer = { getCurrentTime(): number; destroy(): void };
type YTApi = {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      playerVars?: Record<string, number>;
      events?: { onReady?: () => void; onError?: () => void };
    },
  ) => YTPlayer;
};
declare global {
  interface Window {
    YT?: YTApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTApi> | null = null;
function loadYouTubeApi(): Promise<YTApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise<YTApi>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => {
      apiPromise = null;
      reject(new Error("player script failed"));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

const btn = "min-h-11 min-w-11 rounded px-4 font-medium";
const secondary = `${btn} border border-neutral-400 bg-white`;
const primary = `${btn} bg-neutral-900 text-white disabled:opacity-50`;

export function CaptureForm({ initialUrl }: { initialUrl: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<Lookup | null>(null);
  const [playerFailed, setPlayerFailed] = useState(false);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const playerEl = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);

  const lookup = useCallback(async (value: string) => {
    setError(null);
    setSaved(null);
    setInfo(null);
    setLoading(true);
    try {
      const res = await fetch("/api/capture/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: value }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.message ?? "Couldn't look that up. Try again.");
        return;
      }
      const l = data as Lookup;
      setInfo(l);
      setPlayerFailed(false);
      setTitle(l.title);
      setStart(l.startSec !== null ? formatTime(l.startSec) : "");
      setEnd("");
      setNote("");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Build the embedded player; any failure falls back to the link-out below.
  useEffect(() => {
    if (!info || !info.embeddable || !playerEl.current) return;
    let cancelled = false;
    const host = playerEl.current;
    const mount = document.createElement("div");
    host.appendChild(mount);
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        player.current = new YT.Player(mount, {
          videoId: info.videoId,
          playerVars: { playsinline: 1, start: info.startSec ?? 0 },
          events: { onError: () => setPlayerFailed(true) },
        });
      })
      .catch(() => setPlayerFailed(true));
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
  }, [info]);

  const showPlayer = !!info && info.embeddable && !playerFailed;
  const startSec = parseTime(start);
  const endSec = parseTime(end);
  const startBad = start.trim() !== "" && startSec === null;
  const endBad = end.trim() !== "" && endSec === null;
  const endNeedsStart = endSec !== null && startSec === null;
  const endBeforeStart = endSec !== null && startSec !== null && endSec <= startSec;
  const needsTitle = !info?.duplicate && title.trim() === "";
  const invalid = startBad || endBad || endNeedsStart || endBeforeStart || needsTitle;

  function mark(set: (v: string) => void) {
    const t = player.current?.getCurrentTime();
    if (typeof t === "number") set(formatTime(t));
  }

  async function save() {
    if (!info || invalid) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/capture/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          videoId: info.videoId,
          title: title.trim(),
          rawTitle: info.rawTitle,
          rawChannel: info.rawChannel,
          startSec,
          endSec,
          note: note.trim() === "" ? null : note,
          entryId: info.duplicate ? info.duplicate.id : null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 409 && data?.entry) {
        // Saved by someone else between lookup and save: switch to the duplicate flow.
        setInfo({ ...info, duplicate: data.entry });
        setError("That song is already in your journal. Add a highlight to it instead.");
        return;
      }
      if (!res.ok) {
        setError(data?.message ?? "Couldn't save. Your note is still here; try again.");
        return;
      }
      setSaved(
        data.status === "needs_why"
          ? "Saved. It's in your inbox waiting for a why."
          : "Saved. It's in your inbox waiting for tags.",
      );
      setInfo(null);
      setUrl("");
    } catch {
      setError("Couldn't reach the server. Your note is still here; try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) void lookup(url.trim());
        }}
      >
        <label htmlFor="url" className="text-sm font-medium">
          YouTube link
        </label>
        <div className="flex gap-2">
          <input
            id="url"
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a link"
            className="min-h-11 min-w-0 flex-1 rounded border border-neutral-400 px-3"
          />
          <button type="submit" disabled={loading || !url.trim()} className={primary}>
            {loading ? "Loading" : "Load"}
          </button>
        </div>
      </form>

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="rounded bg-green-50 p-3 text-sm text-green-900">
          {saved} Paste another link to keep going.
        </p>
      ) : null}

      {info ? (
        <div className="flex flex-col gap-4">
          {info.duplicate ? (
            <div role="status" className="rounded border border-amber-400 bg-amber-50 p-3 text-sm">
              <p>
                <strong>{info.duplicate.title}</strong> is already in your journal.
              </p>
              <p className="mt-1">Your highlight will be added to that entry.</p>
            </div>
          ) : (
            <div>
              <label htmlFor="title" className="text-sm font-medium">
                Title
              </label>
              <input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 min-h-11 w-full rounded border border-neutral-400 px-3"
              />
              {info.artist ? <p className="mt-1 text-sm text-neutral-600">Artist (from the video): {info.artist}</p> : null}
              {!info.embeddable ? (
                <p className="mt-1 text-sm text-neutral-600">
                  YouTube didn&apos;t share this video&apos;s details, so type the title yourself.
                </p>
              ) : null}
            </div>
          )}

          {showPlayer ? (
            <div className="aspect-video w-full overflow-hidden rounded bg-black [&_iframe]:h-full [&_iframe]:w-full">
              <div ref={playerEl} className="h-full w-full" />
            </div>
          ) : (
            <p className="rounded bg-neutral-100 p-3 text-sm">
              This video can&apos;t be played here.{" "}
              <a
                href={info.watchUrl.replace(/&t=\d+s$/, "") + (startSec ? `&t=${startSec}s` : "")}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline"
              >
                Open it on YouTube
              </a>{" "}
              and type the times below.
            </p>
          )}

          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium">Moment (optional)</legend>
            <TimeRow
              id="start"
              label="Start"
              value={start}
              onChange={setStart}
              bad={startBad}
              onMark={showPlayer ? () => mark(setStart) : undefined}
              onClear={() => setStart("")}
            />
            <TimeRow
              id="end"
              label="End"
              value={end}
              onChange={setEnd}
              bad={endBad || endNeedsStart || endBeforeStart}
              onMark={showPlayer ? () => mark(setEnd) : undefined}
              onClear={() => setEnd("")}
            />
            {endNeedsStart ? <p className="text-sm text-red-700">An end time needs a start time.</p> : null}
            {endBeforeStart ? <p className="text-sm text-red-700">End must be after start.</p> : null}
            {startBad || endBad ? <p className="text-sm text-red-700">Use m:ss, like 1:15.</p> : null}
            <p className="text-sm text-neutral-600">Leave both empty to save the whole song.</p>
          </fieldset>

          <div>
            <label htmlFor="note" className="text-sm font-medium">
              Why does it move you? (optional)
            </label>
            <textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded border border-neutral-400 p-3"
            />
          </div>

          <button type="button" onClick={() => void save()} disabled={saving || invalid} className={primary}>
            {saving ? "Saving" : info.duplicate ? "Add highlight" : "Save"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function TimeRow(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  bad: boolean;
  onMark?: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={props.id} className="w-10 text-sm">
        {props.label}
      </label>
      <input
        id={props.id}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        inputMode="numeric"
        placeholder="m:ss"
        aria-invalid={props.bad}
        className={`min-h-11 w-24 rounded border px-3 ${props.bad ? "border-red-600" : "border-neutral-400"}`}
      />
      {props.onMark ? (
        <button type="button" onClick={props.onMark} className={secondary}>
          Mark
        </button>
      ) : null}
      <button type="button" onClick={props.onClear} className={secondary} aria-label={`Clear ${props.label.toLowerCase()}`}>
        ×
      </button>
    </div>
  );
}
