"use client";

import { useState } from "react";
import { ActionButton } from "@/app/_components/action-button";

/** A soft-deleted entry. If a live entry already has its source, offers to move the highlights onto it instead. */
export function DeletedRow({
  id,
  title,
  highlightCount,
}: {
  id: string;
  title: string;
  highlightCount: number;
}) {
  const [conflict, setConflict] = useState<{ id: string; title: string } | null>(null);
  return (
    <li className="rounded border border-neutral-300 p-3">
      <p className="font-medium">{title}</p>
      <p className="text-sm text-neutral-600">
        {highlightCount} highlight{highlightCount === 1 ? "" : "s"}
      </p>
      <div className="mt-2">
        <ActionButton
          url={`/api/entries/${id}/restore`}
          label="Restore"
          onConflict={(data) => {
            const c = (data as { conflict?: { id: string; title: string } } | null)?.conflict;
            if (c) setConflict(c);
          }}
        />
      </div>
      {conflict && (
        <div className="mt-3 rounded bg-amber-50 p-3 text-sm" role="status">
          <p>
            Can&apos;t restore: &quot;{conflict.title}&quot; already has this video. Move these highlights onto it instead?
          </p>
          <div className="mt-2">
            <ActionButton url={`/api/entries/${id}/move-highlights`} label="Move highlights" />
          </div>
        </div>
      )}
    </li>
  );
}
