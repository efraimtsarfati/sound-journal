# MCP server (the agent interface)

Sound Journal exposes a remote MCP server so the owner can connect their own agent. The agent provides everything AI-related — voice capture, tagging, metadata matching, discovery, "how do I play this?" — so the app itself needs no AI API key.

- **Endpoint:** `${APP_ORIGIN}/api/mcp`
- **Auth:** OAuth 2.1 (discovery at `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`, dynamic client registration, consent page). Any MCP client that supports remote servers with OAuth can connect. Decided in M5a: the consent page asks for the owner's `APP_PASSWORD` (the same check and the same per-IP 5-fails/15-minute lockout as the login page, no separate PIN); the authorization code lives 60 seconds, the access token 1 hour, the refresh token 90 days (sliding, rotated on use); PKCE `S256` only; `APP_ORIGIN` must be set or discovery and consent refuse to work.
- **Server info:** name `sound-journal`, version from `package.json` (so an agent can tell which release it's connected to).
- **Connector switches:** `enabled`, `allowChanges`, `allowDeletes` (defaults: on, on, off), set on the web app's **Settings** page (Connector: on/off, Allow changes, Allow deletes). Every tool checks them on every call and returns a refusal naming the switch, never an empty result. Read tools need `enabled`; change tools and `restore_deleted` need `enabled` and `allowChanges`; delete tools need `enabled`, `allowChanges` **and** `allowDeletes`. Settings also lists the connected apps (name as the app gave it, connected and last-used times) with **Revoke**, which deletes the grant and so every token of that app at once.
- **Server errors:** a rule of the journal that is broken (not found, missing note, last highlight, bad input) comes back as a readable refusal. Anything unexpected is logged on the server and the agent only sees "Something went wrong on the server; try again.", never database text.

## Tools (v1)

All tools call `lib/core` functions only. Read tools are annotated `readOnlyHint: true`; delete tools `destructiveHint: true`. Every tool returns human-readable text plus `structuredContent`.

### Read

| Tool | Input | Returns |
|---|---|---|
| `list_inbox` | `limit?` | Highlights in `needs_why` and `needs_tags`, with entry title/artist, timestamps and note |
| `get_taxonomy` | — | Axes (from `axes.json`) and every approved/proposed tag with axis, state and usage count; rejected slugs |
| `search_highlights` | `query?` (meaning search through the vector index, with a score; without a configured index or when it errors, a case-insensitive text match on the note with no score), `tags?`, `axis?`, `artist?`, `status?`, `from?`/`to?` (captured date, `YYYY-MM-DD`, read in the user's `settings.time_zone`; `from` is inclusive, `to` exclusive; dates that are not on the calendar, such as `2026-02-30`, are refused), `limit?` | Matching highlights with entry info, tags and a similarity score when `query` is used |
| `get_entry` | `entry_id` or `url` | The entry, its sources, artists, genres and all highlights |
| `list_entries` | `limit?`, `cursor?`, `artist?` | Entries, newest first. `cursor` is the opaque `nextCursor` of the previous page (an offset no larger than 1,000,000) |

### Change

| Tool | Input | Effect |
|---|---|---|
| `add_entry` | `url` (YouTube, **required in v1**); optional clean `title`, `artists`, `album`, `original_release_year`; `highlights: [{start_sec?, end_sec?, note?}]` | Creates the entry and highlights (or adds highlights to the existing entry if the URL is already saved; the other fields are then ignored and the result says so). With no `highlights`, one whole-song `needs_why` highlight is created for a new entry. For a new entry YouTube's oEmbed is always asked: a video that does not exist is refused even when `title` is given, and the raw YouTube title and channel are stored on the source (`raw_title`, `raw_author`). If `title` is omitted it is read from oEmbed, and the call is refused if that gives nothing (a title is never invented); YouTube is asked before anything is saved, with a 5-second limit, and never while a database transaction is open. A definite 401 or 403 from YouTube (private video, or embedding disabled) still allows a `title` the agent gave (saved without raw metadata); a 404 is refused; a timeout, network error, 5xx or unreadable answer is also refused, with "couldn't verify the video with YouTube, try again later", and nothing is saved. Artists are shared reference rows, reused by normalized name (lowercase, accents and punctuation stripped, leading "the" removed; only artists without an MBID are matched, oldest first); MusicBrainz IDs come with `match_entry` in M7. Returns IDs and statuses |
| `add_highlight` | `entry_id`, `start_sec?`, `end_sec?`, `note?` | Adds a highlight |
| `update_highlight` | `highlight_id`, `note?`, `start_sec?`, `end_sec?` (omitted = unchanged, `null` clears; at least one is required) | Edits; a times-only change keeps the status, otherwise status changes follow the [transition rules](data-model.md#highlight-workflow-highlightsstatus) |
| `set_highlight_tags` | `highlight_id`, `tags: [{name, axis}]` | Sets the highlight's full tag list **as a diff**: tags already on it are kept with their original `added_at`; new ones are attached with `added_at = now`; missing ones are detached. Unknown names are created as `proposed` (with `agent_name` set to the connected app's name); merged names resolve to the surviving tag; workflow-status words (`needs_why`, `needs why`, `needs-tags`, `tagged`) are refused as tag names. Status → `tagged`, or `needs_tags` if the list is empty. Refused if the highlight is `needs_why` |
| `match_entry` (M7) | `entry_id`, `mbid` (a MusicBrainz recording UUID), `confidence: "high" \| "low"` | Stores the MusicBrainz match; `high` → `matched`: the entry takes MusicBrainz's title, album (when it has one), year and artists, and artist genres are fetched; `low` → the MBID is stored as `mbid_candidate`, the entry stays `unmatched`, and the user confirms it in the app. The MBID is always looked up on MusicBrainz first, so an invented or unknown ID is refused and nothing changes. An entry the owner already **confirmed** is never overwritten: `match_entry` of any confidence is refused with "ask the owner to reject the match in the app first" (the song page's "Reject match" button undoes a match). A `low` call on an automatically matched entry is refused; a `high` call re-matches it. Needs "Allow changes" |

### Delete (needs `allowChanges` and `allowDeletes`)

| Tool | Input | Effect |
|---|---|---|
| `delete_highlight` | `highlight_id` | Soft-deletes it (restorable for 30 days). Refused if it's the entry's last highlight — use `delete_entry` |
| `delete_entry` | `entry_id`, `confirm: true` | Soft-deletes the entry and its highlights (restorable for 30 days) |
| `restore_deleted` | `entry_id` or `highlight_id` | Undoes a soft delete (needs only `allowChanges`). An entry comes back with the highlights deleted with it; if the same link was saved again meanwhile it is refused and names that entry. A single highlight can be restored only while its entry is live |

Approving, merging and rejecting tags is done by the user in the web app in v1, not by the agent.

The switch rules above live in `assertConnectorAllows` (`lib/core/connector.ts`); every tool calls it before doing anything.

### Known accepted risks (M5 security review, owner decision 2026-11-21)

- **Tokens are not audience-bound.** Access tokens are opaque random values stored as hashes and only this server accepts them, so there is no audience claim to check; a `resource` parameter is validated at authorization but not recorded on the token. Revisit if a second resource server ever shares this authorization server.
- **Dynamic clients and the authorize redirect.** Any client can register (public, rate-limited, capped at 200) with any https or loopback redirect URI, and the consent page shows the name the client gave itself, which is not verified. The owner must approve every connection with the password, and errors are never redirected to an unregistered URI, but a malicious registered client could still phish the owner into approving it. Accepted for a single-owner app; the Settings page lists connected apps and revokes them.

## Server instructions (sent to every connected agent)

The server's `instructions` field is the house rules, sent in the `initialize` result (the text lives in `BASE_INSTRUCTIONS` and `MATCH_ENTRY_INSTRUCTION` in `lib/mcp/server.ts` and must match this list). Rule 8 refers to `match_entry`, so it is sent only when that tool is registered (`REGISTERS_MATCH_ENTRY` in `lib/mcp/server.ts`, true since M7; `serverInstructions()` omits it otherwise).

> You are connected to the user's Sound Journal: a library of moments in music and why they matter to the user.
> 1. At the start of any Sound Journal task, call `list_inbox` and mention anything waiting.
> 2. Before tagging, call `get_taxonomy`. Reuse existing tags when the meaning fits; create new tags only when nothing fits. New tags are proposals the user will review.
> 3. Tag only what the user's note says. Never tag a highlight with no note — ask the user why they saved it.
> 4. When the user describes a technique in plain words, use the precise term as the tag and briefly explain it to them.
> 5. Genres are not tags. Don't tag artist genres.
> 6. Never invent tracks, links or timestamps. Before saving or suggesting a track, confirm it exists (find its YouTube or Spotify link). If you can't, say so.
> 7. When saving from a description ("around where the guitars come in"), give your best timestamp and tell the user it's approximate so they can adjust it in the app.
> 8. *(M7 onward)* Match entries to MusicBrainz only when confident; otherwise use `confidence: "low"` and let the user confirm.

## The inbox flow

An MCP server can't wake up an agent — the agent only acts while a conversation is running. So "notify the agent" is implemented as an inbox the agent checks:

1. Highlights saved without a note → `needs_why`; with a note but untagged → `needs_tags`.
2. The web app shows inbox counts to the user.
3. Any agent connected to the journal sees the inbox at the start of a task (server instruction 1).
4. For a daily sweep, the user creates a **scheduled task** in their agent, for example:

> Every evening: check my Sound Journal inbox. Tag every highlight that has a note, following the journal's tagging rules. Then list the highlights that still need a "why", with their song and timestamp, so I can add notes.

## Example sessions

**Voice capture (phone):**
> User: "Save Leave Me Alone by New Order, around where the guitars come in. The lines weave around each other like two fairies floating."
> Agent: finds the YouTube link → `add_entry` with a highlight and the note → `get_taxonomy` → `set_highlight_tags` (`interlocking guitars`, `sparse arrangement`, `touching`, `floating`) → tells the user the timestamp is approximate and explains "interlocking guitars".

**Finding things:**
> User: "Pull up everything where I talked about guitars sounding like they're talking to each other."
> Agent: `search_highlights` with that `query` → lists matches with links and timestamps.

## Later tools (see roadmap)

`add_suggestion`, `record_listen_feedback` (discovery loop), `get_taste_summary` (taste map data), `approve_tag` / `merge_tags` (if the user wants the agent to manage vocabulary), board tools (public boards).
