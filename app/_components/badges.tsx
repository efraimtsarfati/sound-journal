import type { HighlightTag } from "@/lib/core";

const STATUS: Record<string, { text: string; cls: string }> = {
  needs_why: { text: "Needs a why", cls: "bg-amber-100 text-amber-900" },
  needs_tags: { text: "Needs tags", cls: "bg-sky-100 text-sky-900" },
  tagged: { text: "Tagged", cls: "bg-emerald-100 text-emerald-900" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { text: status, cls: "bg-neutral-100" };
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.text}</span>;
}

export function TagChip({ tag }: { tag: Pick<HighlightTag, "name" | "axis" | "state"> }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs ${tag.state === "proposed" ? "border-dashed border-neutral-500 text-neutral-700" : "border-neutral-400"}`}
      title={`${tag.axis}${tag.state === "proposed" ? " (proposed)" : ""}`}
    >
      {tag.name}
    </span>
  );
}
