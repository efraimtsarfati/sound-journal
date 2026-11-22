"use client";

const btn = "min-h-11 min-w-11 rounded px-4 font-medium";
const secondary = `${btn} border border-neutral-400 bg-white`;

export function TimeRow(props: {
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
