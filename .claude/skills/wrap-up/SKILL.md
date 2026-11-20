---
name: wrap-up
description: End-of-slice wrap-up for Sound Journal. Run at the end of every build session, before /clear, while the session still remembers what happened. Records where things left off, bugs and gotchas, and doc drift, then commits to the current PR branch.
---

# Wrap-up

Run this in the same session that did the work, before `/clear`. Its value comes from what this session knows and a fresh session won't.

## 1. Gather (don't re-read the codebase)
- `git branch --show-current`, `git log --oneline main..HEAD`, `git diff main...HEAD --stat`
- The latest typecheck / lint / test / build results (re-run them only if they haven't been run since the last change).
- From this session's own history: what broke, what took more than one attempt, what surprised you, where the docs were wrong or silent, and what is unfinished.
- Ask the user one question: "Anything that got in your way this session that I should record?" Include their answer.

## 2. Update `docs/build-plan.md`
- Slice finished and PR open → set its status to ◐ with the PR number (the merge flips it to ☑).
- Slice not finished → leave it ◐ and make sure the dev-log entry says exactly where it stopped.

## 3. Add an entry at the TOP of `docs/dev-log.md`
Newest first, so the next session only reads the top. Keep it under about 15 lines. Use this shape:

```
## YYYY-MM-DD — <slice> — <one-line summary> (PR #n)
**State:** done / partial — <where it stopped, precisely>
**Next:** <the very next action for the next session>
**Gotchas:**
- <symptom> → <cause> → <fix or workaround>
**Doc drift:** <docs changed in this PR, or "none">
**Follow-ups:** <small things deferred, or "none">
```

Leave out sections with nothing in them rather than writing "none" everywhere. No secrets, tokens, personal data or real journal content — the repo is public.

## 4. Promote what will bite again
- A gotcha that **any** future session could hit (tooling, environment, a library quirk) → add one line to the **Gotchas** section of `CLAUDE.md`. Keep that section under 15 lines; merge or drop stale lines rather than letting it grow.
- A gotcha about **one area** → put it in that area's doc (e.g. a Neon quirk in architecture → Environments).
- Code and docs disagree → fix the docs now (or use the `docs-sync` agent). If the code is what's wrong, list it under Follow-ups instead.
- Rotate the log: when `docs/dev-log.md` passes about 30 entries, move all but the latest 10 into `docs/dev-log-archive.md`.

## 5. Commit
Commit only the files above, to the current PR branch (never `main`), with the message `Wrap-up: <slice>`, and push. Then tell the user, in two or three lines, where things stand and what the next session should start with.
