"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Switches = { enabled: boolean; allowChanges: boolean; allowDeletes: boolean };

const ROWS: { key: keyof Switches; label: string; help: string }[] = [
  { key: "enabled", label: "Connector", help: "Off blocks every connected app, even reading." },
  { key: "allowChanges", label: "Allow changes", help: "Lets apps add entries, edit notes, set tags and restore." },
  { key: "allowDeletes", label: "Allow deletes", help: "Lets apps delete (restorable for 30 days). Also needs Allow changes." },
];

/** The three connector switches. Each toggle saves immediately and shows the server's message on failure. */
export function ConnectorSwitches({ initial }: { initial: Switches }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState<keyof Switches | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: keyof Switches) {
    const next = !value[key];
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/settings/connector", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [key]: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.message ?? "That didn't save. Try again.");
        return;
      }
      setValue((v) => ({ ...v, [key]: next }));
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <ul className="flex flex-col gap-2">
        {ROWS.map((r) => (
          <li key={r.key} className="flex min-h-11 items-center justify-between gap-3 rounded border border-neutral-300 p-3">
            <div>
              <div className="font-medium">{r.label}</div>
              <div className="text-sm text-neutral-600">{r.help}</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={value[r.key]}
              aria-label={r.label}
              disabled={busy !== null}
              onClick={() => toggle(r.key)}
              className={`min-h-11 min-w-16 rounded border px-3 font-medium disabled:opacity-50 ${
                value[r.key] ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-400 bg-white"
              }`}
            >
              {value[r.key] ? "On" : "Off"}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
