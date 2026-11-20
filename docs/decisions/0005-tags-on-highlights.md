# 0005 — Tags on highlights; status and genre kept separate

**Status:** accepted · 2026-11-20

## Context
The owner saves moments ("where the guitars come in") as well as whole songs, and wants to search "everything with interlocking guitars" and get the moments he described. He also wants reminders for saves with no "why", and artist genres as context.

## Decision
- An entry has one or more highlights; a whole-song save is a highlight with no timestamp. **Tags attach to highlights.**
- Whole-song highlights and snippet highlights are both tagged, each from its own note, so one entry can carry tags for the song overall and for the moments in it. Qualities the user didn't describe are not tagged.
- "Needs a why" is a **workflow status** on the highlight, not a tag.
- Genres are stored per artist in `artist_genres` with their source, never as user tags.
- The taxonomy's structure (axes) is a versioned file; its vocabulary (tags) is data in the database.

## Consequences
- Searches and the taste map reflect what the user actually heard and said.
- Status never pollutes music searches; genres never pollute the taste map, and can still be compared against it.
- New tags never need a code change; changing axes is a reviewed PR.
