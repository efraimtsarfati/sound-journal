# Vision

## The problem

You hear something that stops you — a guitar part, a chord change, a texture, a line in a film, a passage in a book. Then it's gone. Music that autoplays after an album ends is the worst case: you didn't choose it, so you can't find it again. Even when you *do* save a track to a playlist, you forget **why** a month later — and the "why" was the valuable part.

The "why" is also what makes a reference useful to other people. A tool can guess that a song *sounds* hopeful. Only a person can say "the bridge of this feels like realistic hope," and that sentence is what someone searching for "hopeful but realistic" actually needs.

## What Sound Journal is

A journal of references at the level of **moments**:

1. **Capture** a song (later: film scene, book passage) — the whole thing or a highlighted section.
2. **Say why**, in your own words, typed or spoken through your agent.
3. **Tag** — an AI agent reads your note and tags it on several axes (sound, technique, structure, feeling, lyric, association), reusing your existing vocabulary.
4. **Find it again** by meaning, tag, artist or title.
5. **See your taste** — which qualities you keep saving, and how that changes over time.
6. **Discover** new music that shares those qualities.
7. **Share** (later) — public boards, and community search across everyone's public notes.

## Who it's for

The long-term audience is anyone who collects creative references by feeling: musicians looking for inspiration or samples, writers and screenwriters collecting mood references, directors building a feel for a scene, people articulating what a piece of art means to them, and creators publishing "here's what inspired this" boards for their fans.

**V1 is built for one person: the author, using it as a personal sound journal.** Designing for a real user you can test on every day beats designing for five hypothetical ones. The other audiences are kept possible by the data model, not built for yet.

## What makes it different

Pieces of this exist (see [research notes](research.md)), but not the combination:

| Existing | What it does | What it lacks |
|---|---|---|
| Timestamped song-note apps (e.g. Track Notes) | Private notes tied to moments in Apple Music | Single platform, no sharing, no search by meaning |
| Creator libraries (e.g. Fabric) | Searchable personal library of references | Personal only, not moment-level |
| Reference boards (e.g. Are.na) | Public/closed/private channels of references | Not music-aware: no clip timestamps, no structured "why", no feeling search |
| Mood search engines (e.g. Cyanite) | Find tracks by described vibe, from audio analysis | Machine-inferred moods, not human meaning; whole tracks, not moments |

**The gap:** a specific moment + a person's own reason + across media + a shared pool searchable by feeling. The human-written meaning, attached to moments, is the asset nobody has.

## Guiding principles

1. **Capture must take seconds.** Most saves happen while half-listening. If saving is slow, it won't happen. The note can come later.
2. **The user's language is the data.** Never force someone to pick from a fixed list to describe what they felt. Structure is added by the agent, on top.
3. **Moments over songs.** Tags describe what *you* heard, where you heard it — not a song's overall genre.
4. **Bring your own agent.** The app is the data and the interface; intelligence comes from whatever agent the user connects. This keeps the app free and lets users choose their AI.
5. **Reserve, don't build.** Leave room in the data model for future features (cheap); don't build them early (expensive).
6. **Don't store the encyclopedia.** Store what we search by, plus IDs that let us look up everything else.
7. **Honest data.** Suggested tracks and metadata must be verified to exist before they're shown; agent-proposed tags stay "proposed" until the user approves them.

## Open questions (to revisit, not blockers for v1)

- Name: "Sound Journal" is a working title, and the scope will include film and books.
- Business model, if any. Note: Vercel's Hobby tier is non-commercial only, so any monetization means upgrading hosting.
- How public boards are moderated and how copyright is respected when quoting books or linking film clips.
