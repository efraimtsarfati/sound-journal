# V1 specification

V1 is a personal sound journal for a single owner, usable from phone and laptop, with an MCP server so the owner's own agent can capture, tag and search.

## In scope

### Capture (web app)
- **Add an entry from a YouTube link.** The app reads the video ID (and a `t=` start time if the link has one), fetches the title and channel through YouTube's oEmbed endpoint (no API key; works for public and unlisted videos), and shows the video.
- **Whole song or a highlight.** Save with no timestamp (whole work), or mark a start (and optional end) using the embedded player's current position — "mark it while it plays." Manual mm:ss editing is available but never required. If a video can't be embedded, the app links out to YouTube at the timestamp and times are typed in.
- **Note is optional at save time.** Saving with no note puts the highlight in `needs_why`.
- **Multiple highlights per entry.** Add another highlight to an existing entry, each with its own note.
- **Duplicate check.** Pasting a link already in the journal opens the existing entry and offers to add a highlight, instead of creating a second entry.

### Capture (agent, via MCP)
- The owner can tell their agent (e.g. Claude, by voice on a phone): "Save Leave Me Alone by New Order, around where the guitars come in — they weave around each other." The agent finds the YouTube link, calls `add_entry`, and tags the highlight in the same conversation.

### Inbox and statuses
- Every highlight has a workflow status: `needs_why` → `needs_tags` → `tagged`.
- The web app shows inbox counts ("3 need a why, 2 need tags").
- The MCP server exposes `list_inbox`; its instructions tell any agent to check the inbox first.
- The owner can set up a scheduled task in their agent to sweep the inbox daily (example prompt in [mcp-server.md](mcp-server.md)).

### Tagging (the agent assigns, the owner reviews)
- The agent reads a highlight's note and assigns tags on the taxonomy axes ([taxonomy.md](taxonomy.md)), reusing existing tags from `get_taxonomy`.
- New tags are created as `proposed`; the owner approves, renames, merges or rejects them in the web app, and can remove any tag from a highlight. Adding tags by hand in the app is planned for later.
- Highlights without a note are never tagged — the agent asks for the why instead.
- A whole-song highlight's note is tagged like any other note: by what the note says, never by the song's overall qualities.

### Browse and search
- List of entries (newest first) with their highlights, status badges and tags.
- Entry detail: player that starts at each highlight's timestamp, notes, tags.
- Filter by tag, axis, artist, status.
- Text search on title, artist, album.
- **Meaning search**: free-text query matched against highlight notes (plus title, artist, tags) by semantic similarity.

### Metadata
- Entries store title, artist(s), album, original release year and duration where known.
- Matching to a MusicBrainz recording is attempted (by the agent, or a server-side lookup); uncertain matches stay `unmatched` until confirmed.
- Artist genres from MusicBrainz are stored in a separate layer, never mixed with the owner's tags.

### Access
- Web app: single-owner login (password + signed session cookie), as in macro-log.
- MCP server: OAuth 2.1 with dynamic client registration and a PIN consent page, as in macro-log. Connector switches: enabled / allow changes / allow deletes.
- Works on phone and laptop; installable to the phone home screen (PWA).

## Out of scope for v1 (planned — see [roadmap](roadmap.md))

- Spotify "save what's playing" capture
- Films and books as sources
- Taste map visualization
- Discovery loop (suggestions saved back as `to_listen`)
- Public boards, sharing, multiple users, community search, word clouds
- In-app AI (any AI runs in the user's agent)
- In-app audio recording / dictation (the phone keyboard mic and the agent cover this)

## Acceptance criteria

V1 is done when the owner can, on a phone:

1. Paste a YouTube link, mark a moment while it plays, save with no note — in under 15 seconds.
2. See that highlight in the "needs a why" inbox, add a note later.
3. Ask their agent to tag the inbox; see feeling and technique tags appear, with any new tags marked proposed.
4. Approve or reject proposed tags.
5. Search "two lines circling each other" and find the New Order highlight even though the note says "weaving".
6. Filter to all highlights tagged `interlocking guitars`.
7. Tell their agent by voice to save a song with a reason, and find it in the app tagged.
8. Open the entry and have the player start at the highlight.

And when the engineering bar is met: CI green on `main`, migrations reproducible from an empty database, core functions covered by tests, and docs updated to match what shipped.

## Non-functional requirements

- **Cost:** stays within free tiers (Vercel Hobby, Neon Free, Upstash Vector Free). See limits in [architecture.md](architecture.md).
- **Mobile-first:** usable one-handed at ~375px wide; tap targets at least 44×44px.
- **Speed:** capture screen interactive in under 2 seconds on a phone connection.
- **Privacy:** everything private by default; `visibility` exists in the data but only `private` is allowed in v1.
- **Data safety:** export of all data as JSON from the web app; deletes are soft and restorable for 30 days.
