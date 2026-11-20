# 0004 — YouTube as the first source, Spotify later

**Status:** accepted · 2026-11-20

## Context
The owner listens on Spotify (Premium), and "save what's playing" would be the fastest capture. But Spotify's Web API now limits Development Mode apps: the developer needs Premium, and each app allows up to five authorized users. Extended access is reserved for established, large-scale use cases. Spotify also removed recommendations, related artists and audio features for new apps in November 2024.

## Decision
V1 uses YouTube links: the public oEmbed endpoint for title and channel (no key) and the IFrame Player API for playback and marking timestamps. The data model stores sources in `entry_sources` with a `type`, so Spotify (and film/book sources) can be added later as adapters.

## Consequences
- Works for anyone, with no API key and no user cap.
- Capture is "paste a link" rather than "tap to save what's playing" in v1; the agent covers voice capture.
- YouTube titles are messy ("Official Audio", "Remastered"), so entries keep the raw title and are matched to MusicBrainz for clean metadata.
- Timestamps are measured on the entry's primary source; different uploads can have different intros.

## Alternatives considered
- **Spotify first** — best capture experience for the owner, but a dead end for a public version.
