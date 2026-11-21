"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * A button that calls an API route, then refreshes the page. Shows the server's message on failure.
 * `confirmText` asks first (for deletes).
 */
export function ActionButton({
  url,
  method = "POST",
  body,
  label,
  confirmText,
  className = "",
  onConflict,
}: {
  url: string;
  method?: "POST" | "DELETE";
  body?: unknown;
  label: string;
  confirmText?: string;
  className?: string;
  /** Called with the parsed response on a 409 so the caller can show a choice instead of an error. */
  onConflict?: (data: unknown) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 409 && onConflict) {
        onConflict(data);
        return;
      }
      if (!res.ok) {
        setError(data?.message ?? "That didn't work. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className={`min-h-11 min-w-11 rounded border border-neutral-400 bg-white px-4 font-medium disabled:opacity-50 ${className}`}
      >
        {busy ? "…" : label}
      </button>
      {error && (
        <span role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </span>
      )}
    </span>
  );
}
