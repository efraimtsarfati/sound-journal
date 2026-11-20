# Sound Journal

A personal reference library for the **moments** in music (and later film and books) that move you, and for **why**.

You hear something — a whole song, or just the bit where the guitars start weaving around each other — and you save it with a note in your own words. An AI agent you connect (Claude, or any MCP client) reads your notes, tags them against a shared taxonomy, and helps you find them again by meaning ("sparse, two lines circling each other"), not just by title. Over time the journal becomes a map of your taste, and a starting point for discovering new music with the qualities you keep coming back to.

> **Status:** design phase. No application code yet — this repository currently holds the documentation that the code will be built against. See [`docs/roadmap.md`](docs/roadmap.md) for where things are.

## Core ideas

- **Highlights, not just songs.** An entry is a song (or film, or book); a *highlight* is a moment in it (or the whole thing) plus your note. Tags live on highlights.
- **Your words are the data.** Search works on the meaning of what you wrote, so your phrasing and someone else's don't have to match.
- **Bring your own agent.** The app stores and shows; your agent does the thinking (tagging, voice capture, discovery, "how do I play this?") through an MCP server. No AI API key is required to run the app.
- **Free to run.** Vercel Hobby + Neon Postgres (free) + Upstash Vector (free).
- **Built to grow.** Films, books, Spotify capture, public boards and community search are planned for and have reserved extension points — see the roadmap.

## Documentation

Read in this order:

| Doc | What it covers |
|---|---|
| [Vision](docs/vision.md) | The problem, who it's for, what makes it different, guiding principles |
| [V1 spec](docs/spec-v1.md) | Exactly what the first version does and doesn't do, with acceptance criteria |
| [Architecture](docs/architecture.md) | Components, stack, layering rules, free-tier limits |
| [Data model](docs/data-model.md) | Tables, fields, statuses, extension points |
| [Taxonomy](docs/taxonomy.md) | How tags are organized (axes), how vocabulary grows, tagging rules |
| [MCP server](docs/mcp-server.md) | The agent interface: tools, server instructions, the inbox flow |
| [Roadmap](docs/roadmap.md) | Milestones for v1 and how each future feature gets added |
| [Build plan](docs/build-plan.md) | Milestones split into Claude Code sessions, with the model and agent for each, plus the kickoff prompt |
| [Dev log](docs/dev-log.md) | Where things left off, gotchas and fixes, newest first |
| [Engineering workflow](CONTRIBUTING.md) | Branches, pull requests, checks, previews, migrations, definition of done |
| [Decision records](docs/decisions/) | Why the big choices were made |
| [Research notes](docs/research.md) | Existing products and platform constraints this design responds to |

AI coding sessions should also read [`CLAUDE.md`](CLAUDE.md).

## License

Not yet chosen. Until a license is added, all rights are reserved by the author.
