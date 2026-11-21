export type CoreErrorCode =
  | "invalid_input"
  | "not_found"
  | "last_highlight"
  | "needs_why"
  | "tag_rejected"
  | "tag_conflict"
  | "invalid_state"
  | "cross_user";

/** A rule of the journal was broken. Wrappers (pages, API routes, MCP tools) map the code to a response. */
export class CoreError extends Error {
  constructor(
    readonly code: CoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CoreError";
  }
}
