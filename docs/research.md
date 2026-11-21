# Research notes

What already exists, and the platform constraints the design responds to. Checked November 2026; re-check before relying on any limit.

## Existing products

| Product | What it does | Relevance |
|---|---|---|
| [Track Notes](https://apps.apple.com/us/app/track-notes-music-annotation/id6748657065) (iOS) | Timestamped notes on Apple Music tracks; notes viewable only inside the app | Proves the "I saved a reference and forgot why" problem; private and single-platform |
| [Fabric for music creators](https://fabric.so/for/music-creators) | Searchable personal library of samples, references, lyrics and voice memos, findable by mood or description | Closest personal library; not moment-level, not communal |
| [Are.na](https://help.are.na/getting-started/channels) | Channels of references that are open, closed or private | Closest community model; not music-aware (no timestamps, no structured "why") |
| [Cyanite](https://cyanite.ai) | AI music tagging plus similarity and free-text search over catalogs | Machine-inferred moods from audio; whole tracks; built for catalog owners |
| Mood/vibe playlist apps (Attune, Wavelength and similar) | Describe a vibe, get a playlist | Discovery by vibe, but no personal journal or human-written meaning |

**Gap:** moment-level references + the person's own reason + multiple media + a shared pool searchable by feeling.

## Platform constraints

### Spotify Web API
- **November 2024:** new apps lost Related Artists, Recommendations, Audio Features, Audio Analysis, featured/category playlists and 30-second previews in some responses. ([Spotify](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api))
- **May 2025:** Extended Quota access reserved for established, scalable use cases. ([Spotify](https://developer.spotify.com/blog/2025-04-15-updating-the-criteria-for-web-api-extended-access))
- **February 2026:** Development Mode requires the developer to have Premium, one Development Mode Client ID per developer, up to five authorized users per Client ID. ([Spotify](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security))
- **July 2026:** Development Mode app limit raised to 25; quotas now counted per developer account. ([Spotify](https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates))
- **Implication:** Spotify capture is fine for personal use; a public version can't depend on it. Discovery can't use Spotify recommendations; playlists can be made through the user's own Spotify connector in their agent.

### Upstash
- Free Redis accounts get one database ([Upstash](https://upstash.com/docs/redis/overall/pricing)) — already used by macro-log.
- Upstash Vector can embed raw text with a hosted model chosen at index creation ([Upstash](https://upstash.com/docs/vector/features/embeddingmodels)); the listed dense model is `openai/text-embedding-3-small` (1536 dimensions). Free tier allows 10K queries/updates per day and up to 1536 dimensions. The pricing page ([Upstash](https://upstash.com/pricing/vector)) doesn't mention embedding costs. Confirmed in practice on 2026-11-21: the console allows that model on the Free plan, and a Free index only moves to pay-as-you-go once a card is added. BGE models are no longer offered for new indexes.

### Neon
- Free plan: 100 projects, 10 branches per project, 100 CU-hours per project per month, 1 GB storage per project, 20 GB total. ([Neon](https://neon.com/faqs/free-plan-limits-and-quotas))

### Vercel
- Hobby plan is free, non-commercial personal use only. ([Vercel](https://vercel.com/docs/limits/fair-use-guidelines))

### Last.fm
- Free API key; `track.getSimilar` (based on listening data), `tag.getTopTracks`, `tag.getSimilar`. ([Last.fm](https://www.last.fm/api/show/track.getSimilar)) Useful as a genre-level discovery signal.

### MusicBrainz
- Free, open music metadata with stable IDs for recordings and artists, plus relationships (members, credits). Rate-limited; requests need a descriptive User-Agent. Verify current rate limits before M7.

## Discovery experiment (2026-11-20)

A test playlist was generated from one highlight (New Order — "Leave Me Alone", interlocking/sparse/touching guitar lines) using agent reasoning plus the Spotify connector. Requested tracks included The Durutti Column, The Chameleons, Television, Radiohead ("Weird Fishes/Arpeggi"), American Football, Explosions in the Sky, Felt, Real Estate, The Feelies, The Smiths and Talking Heads. Spotify's generator may substitute tracks; the owner's listening feedback is the real result and should be recorded once the journal exists.
