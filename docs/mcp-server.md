# MCP server (the agent interface)

Sound Journal exposes a remote MCP server so the owner can connect their own agent. The agent provides everything AI-related — voice capture, tagging, metadata matching, discovery, "how do I play this?" — so the app itself needs no AI API key.

- **Endpoint:** `${APP_ORIGIN}/api/mcp`
- **Auth:** OAuth 2.1 (discovery at `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`, dynamic client registration, PIN consent page). Any MCP client that supports remote servers with OAuth can connect.
- **Server info:** name `sound-journal`, version from `package.json` (so an agent can tell which release it's connected to).
- **Connector switches** (set in the web app): `enabled`, `allowChanges`, `allowDeletes`. Every tool checks them and returns a refusal naming the switch, never an empty result.

## Tools (v1)

All tools call `lib/core` functions only. Read tools are annotated `readOnlyHint: true`; delete tools `destructiveHint: true`. Every tool returns human-readable text plus `structuredContent`.

### Read

| Tool | Input | Returns |
|---|---|---|
| `list_inbox` | `limit?` | Highlights in `needs_why` and `needs_tags`, with entry title/artist, timestamps and note |
| `get_taxonomy` | — | Axes (from `axes.json`) and every approved/proposed tag with axis, state and usage count; rejected slugs |
| `search_highlights` | `query?` (meaning search), `tags?`, `axis?`, `artist?`, `status?`, `from?`/`to?` (captured date), `limit?` | Matching highlights with entry info, tags and a similarity score when `query` is used |
| `get_entry` | `entry_id` or `url` | The entry, its sources, artists, genres and all highlights |
| `list_entries` | `limit?`, `cursor?`, `artist?` | Entries, newest first |

### Change

| Tool | Input | Effect |
|---|---|---|
| `add_entry` | `url` (YouTube, **required in v1**); optional clean `title`, `artists`, `album`, `original_release_year`; `highlights: [{start_sec?, end_sec?, note?}]` | Creates the entry and highlights (or adds highlights to the existing entry if the URL is already saved). Returns IDs and statuses |
| `add_highlight` | `entry_id`, `start_sec?`, `end_sec?`, `note?` | Adds a highlight |
| `update_highlight` | `highlight_id`, `note?`, `start_sec?`, `end_sec?` | Edits; status changes follow the [transition rules](data-model.md#highlight-workflow-highlightsstatus) |
| `set_highlight_tags` | `highlight_id`, `tags: [{name, axis}]` | Sets the highlight's full tag list **as a diff**: tags already on it are kept with their original `added_at`; new ones are attached with `added_at = now`; missing ones are detached. Unknown names are created as `proposed`. Status → `tagged`. Refused if the highlight is `needs_why` |
| `match_entry` | `entry_id`, `mbid`, `confidence: "high" \| "low"` | Stores the MusicBrainz match; `high` → `matched`, `low` → stays `unmatched` for the user to confirm. Fetches artist genres |

### Delete (needs `allowDeletes`)

| Tool | Input | Effect |
|---|---|---|
| `delete_highlight` | `highlight_id` | Soft-deletes it (restorable for 30 days). Refused if it's the entry's last highlight — use `delete_entry` |
| `delete_entry` | `entry_id`, `confirm: true` | Soft-deletes the entry and its highlights (restorable for 30 days) |
| `restore_deleted` | `entry_id` or `highlight_id` | Undoes a soft delete (needs only `allowChanges`) |

Approving, merging and rejecting tags is done by the user in the web app in v1, not by the agent.

## Server instructions (sent to every connected agent)

The server's `instructions` field is the house rules. Draft:

> You are connected to the user's Sound Journal: a library of moments in music and why they matter to the user.
> 1. At the start of any Sound Journal task, call `list_inbox` and mention anything waiting.
> 2. Before tagging, call `get_taxonomy`. Reuse existing tags when the meaning fits; create new tags only when nothing fits. New tags are proposals the user will review.
> 3. Tag only what the user's note says. Never tag a highlight with no note — ask the user why they saved it.
> 4. When the user describes a technique in plain words, use the precise term as the tag and briefly explain it to them.
> 5. Genres are not tags. Don't tag artist genres.
> 6. Never invent tracks, links or timestamps. Before saving or suggesting a track, confirm it exists (find its YouTube or Spotify link). If you can't, say so.
> 7. When saving from a description ("around where the guitars come in"), give your best timestamp and tell the user it's approximate so they can adjust it in the app.
> 8. Match entries to MusicBrainz only when confident; otherwise use `confidence: "low"` and let the user confirm.

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
