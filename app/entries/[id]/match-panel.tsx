import { ActionButton } from "@/app/_components/action-button";
import type { Entry } from "@/lib/db";

const mbUrl = (mbid: string) => `https://musicbrainz.org/recording/${mbid}`;

/** Shows the MusicBrainz match state; a waiting candidate gets Yes/No buttons. Nothing is shown for an unmatched entry with no candidate. */
export function MatchPanel({ entry }: { entry: Entry }) {
  if (entry.mbidCandidate && entry.matchStatus === "unmatched") {
    return (
      <section aria-label="Confirm match" className="mt-3 rounded border border-amber-400 bg-amber-50 p-3">
        <p className="font-medium">Confirm match?</p>
        <p className="mt-1 text-sm text-neutral-700">
          Your agent thinks this song is{" "}
          <a href={mbUrl(entry.mbidCandidate)} target="_blank" rel="noreferrer" className="underline">
            this MusicBrainz recording
          </a>
          . Confirming replaces the title, album, year and artists with MusicBrainz&apos;s and fetches genres.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <ActionButton url={`/api/entries/${entry.id}/match/confirm`} label="Yes, that's it" />
          <ActionButton url={`/api/entries/${entry.id}/match/reject`} label="No, not this one" />
        </div>
      </section>
    );
  }
  if (entry.mbid && entry.matchStatus !== "unmatched") {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-neutral-600">
        <span>
          {entry.matchStatus === "confirmed" ? "Match confirmed" : "Matched"} on{" "}
          <a href={mbUrl(entry.mbid)} target="_blank" rel="noreferrer" className="underline">
            MusicBrainz
          </a>
        </span>
        <ActionButton url={`/api/entries/${entry.id}/match/reject`} label="Reject match" confirmText="Undo this MusicBrainz match? The title and artists stay as they are." />
      </div>
    );
  }
  return null;
}
