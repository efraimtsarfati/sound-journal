# Taxonomy

The taxonomy is how free-form notes become something you can filter, count and map — without making anyone pick words from a fixed list.

## Two parts

| Part | Where it lives | Changes how |
|---|---|---|
| **Structure** — the *kinds* of reasons (axes) | [`taxonomy/axes.json`](../taxonomy/axes.json), in git | Rarely; by pull request, with a version bump |
| **Vocabulary** — the actual tags | `tags` table in Postgres | Constantly; the agent proposes, the user approves |

Keeping the vocabulary out of git means a new tag never needs a code change. Keeping the structure in git means the categories are reviewed, versioned and documented.

## The axes (v1)

| Axis | Question | Example tags |
|---|---|---|
| `sound` | What does it sound like? | chorus-drenched guitar, dry vocals, tape saturation |
| `technique` | How is it played or made? | interlocking guitars, arpeggiated lines, ghost notes |
| `structure` | What happens in the arrangement? | slow build, key change, sparse arrangement |
| `feeling` | How does it feel? | touching, hopeful but realistic, floating |
| `lyric` | What is it saying? | vivid imagery, repetition as mantra |
| `association` | What does it connect to for me? | night driving, sample candidate |

The axes answer the question "did you save this for the sound, the playing, the arrangement, the emotion, the words, or what it means to you?" — and a single note usually touches several.

## Worked example

Highlight on *New Order — Leave Me Alone*, at the point the guitar lines enter:

> "Feels very touching. Cool how each line weaves its way through the others — sparse and open, like two fairies floating around each other."

| Axis | Tags |
|---|---|
| technique | `interlocking guitars` |
| structure | `sparse arrangement` |
| feeling | `touching`, `floating` |

Notice what is **not** tagged: `post-punk` (that's the artist's genre — it lives in the separate genre layer) and anything the note doesn't say.

## Rules for tagging

In v1 the agent assigns tags and the owner reviews them (approve, rename, merge, reject, remove). These rules apply to whoever tags:

1. **Tag only what the note says.** Don't add qualities from general knowledge of the song. If the note is empty, don't tag — ask for the why.
2. **Reuse before you create.** Call `get_taxonomy` first. If an existing tag fits ("woven guitars" → `interlocking guitars`), use it.
3. **One quality per tag, one axis per tag.** `touching` and `floating` are two tags, not one.
4. **Offer the precise term.** If the user describes a technique in plain words, the precise term is the right tag, and the agent should tell the user what it means. This is how the journal builds the user's vocabulary.
5. **New tags are `proposed`** until the user approves them.
6. **Format:** lowercase, 1–4 words, hyphens allowed, no other punctuation. Workflow-status words (`needs_why`, `needs_tags`, `tagged`, in any spelling) are refused as tag names.

## How the vocabulary converges

Without care, the vocabulary drifts: `weaving guitars`, `woven guitars`, `interlocking guitar lines`. Three mechanisms keep it clean:

1. `get_taxonomy` returns every approved and proposed tag with usage counts, so the agent sees what exists.
2. Proposed tags show in a review list in the web app: approve, rename, merge into another tag, or reject.
3. Merging moves all assignments to the surviving tag; rejected slugs are remembered so they aren't proposed again.

## Changing the structure

Adding, renaming or splitting an axis is a pull request that:
- edits `taxonomy/axes.json` and bumps `version`,
- includes a migration if existing tags need to move to the new axis,
- updates this document,
- adds a decision record if the change is significant.

## Not in the taxonomy (on purpose)

- **Workflow status** (`needs_why`, `needs_tags`, `tagged`) — a status describes where an item is in your process, not the music.
- **Genres** — external facts about artists, stored in `artist_genres` with their source.
- **Qualities the user didn't note** — a whole song and a snippet are both tagged, each from its own note. Neither gets tags the agent infers from general knowledge of the song.
