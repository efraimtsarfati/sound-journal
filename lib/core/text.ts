import axes from "../../taxonomy/axes.json";
import { CoreError } from "./errors";

/** Blank or whitespace-only notes are stored as NULL. Other notes are kept verbatim. */
export function normalizeNote(note: string | null | undefined): string | null {
  if (note == null) return null;
  return /\S/.test(note) ? note : null;
}

export const AXIS_IDS: readonly string[] = axes.axes.map((a) => a.id);

export function assertAxis(axis: string): void {
  if (!AXIS_IDS.includes(axis)) {
    throw new CoreError("invalid_input", `Unknown axis "${axis}". Expected one of: ${AXIS_IDS.join(", ")}.`);
  }
}

const WORD = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Tag format (docs/taxonomy.md rule 6): lowercase, 1-4 words, hyphens allowed, no other punctuation. */
export function normalizeTagName(raw: string): { name: string; slug: string } {
  const name = raw.trim().toLowerCase().replace(/\s+/g, " ");
  const words = name.split(" ");
  if (name === "" || words.length > 4 || !words.every((w) => WORD.test(w))) {
    throw new CoreError(
      "invalid_input",
      `Invalid tag name "${raw}": use lowercase, 1-4 words, hyphens allowed, no other punctuation.`,
    );
  }
  return { name, slug: words.join("-") };
}

export function assertTimes(startSec: number | null, endSec: number | null): void {
  if (startSec !== null && (!Number.isInteger(startSec) || startSec < 0)) {
    throw new CoreError("invalid_input", "start_sec must be a whole number of seconds, 0 or more.");
  }
  if (endSec !== null) {
    if (startSec === null) throw new CoreError("invalid_input", "end_sec requires start_sec.");
    if (!Number.isInteger(endSec) || endSec <= startSec) {
      throw new CoreError("invalid_input", "end_sec must be a whole number greater than start_sec.");
    }
  }
}
