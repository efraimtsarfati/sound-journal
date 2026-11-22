import { after } from "next/server";
import { OWNER_USER_ID, syncSearchQuietly } from "../core";
import { getDb } from "../db";

/** After the response is sent, pushes the owner's dirty highlights to the search index (never throws). */
export function syncSearchAfterResponse(): void {
  after(() => syncSearchQuietly(getDb(), OWNER_USER_ID));
}
