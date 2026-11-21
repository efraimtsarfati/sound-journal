"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButton } from "@/app/_components/action-button";

type Target = { id: string; name: string };

/** One proposed tag: approve, reject, rename, or merge into an approved tag on the same axis. */
export function TagRow({
  id,
  name,
  axis,
  uses,
  targets,
}: {
  id: string;
  name: string;
  axis: string;
  uses: number;
  targets: Target[];
}) {
  const router = useRouter();
  const [newName, setNewName] = useState(name);
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function post(body: unknown) {
    setError(null);
    const res = await fetch(`/api/tags/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (!res?.ok) {
      setError(data?.message ?? "That didn't work. Try again.");
      return;
    }
    router.refresh();
  }

  const field = "min-h-11 rounded border border-neutral-400 px-3";
  const btn = "min-h-11 min-w-11 rounded border border-neutral-400 bg-white px-4 font-medium";
  return (
    <li className="rounded border border-neutral-300 p-3">
      <p>
        <span className="font-medium">{name}</span>{" "}
        <span className="text-sm text-neutral-600">
          {axis} · on {uses} highlight{uses === 1 ? "" : "s"}
        </span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <ActionButton url={`/api/tags/${id}`} body={{ action: "approve" }} label="Approve" className="!bg-neutral-900 !text-white" />
        <ActionButton
          url={`/api/tags/${id}`}
          body={{ action: "reject" }}
          label="Reject"
          confirmText={`Reject "${name}"? It is removed from ${uses} highlight${uses === 1 ? "" : "s"}.`}
        />
      </div>
      <form
        className="mt-2 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim() && newName.trim() !== name) void post({ action: "rename", name: newName });
        }}
      >
        <label className="sr-only" htmlFor={`rename-${id}`}>
          New name
        </label>
        <input id={`rename-${id}`} className={`${field} min-w-0 flex-1`} value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button type="submit" className={btn}>
          Rename
        </button>
      </form>
      {targets.length > 0 && (
        <form
          className="mt-2 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (target) void post({ action: "merge", targetId: target });
          }}
        >
          <label className="sr-only" htmlFor={`merge-${id}`}>
            Merge into
          </label>
          <select id={`merge-${id}`} className={`${field} min-w-0 flex-1`} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Merge into…</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button type="submit" className={btn} disabled={!target}>
            Merge
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </li>
  );
}
