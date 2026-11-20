---
name: wrap-up
description: End-of-slice wrap-up for Sound Journal. Run at the end of every build session, before /clear, while the session still remembers what happened. Records where things left off, bugs and gotchas, and doc drift, then commits to the current PR branch.
model: haiku
effort: low
---

# Wrap-up

Run this in the same session that did the work, before `/clear`. Its value comes from what this session knows and a fresh session won't.

## 1. Gather (don't re-read the codebase)
- `git branch --show-current`, `git log --oneline main..HEAD`, `git diff main...HEAD --stat`
- The latest typecheck / lint / test / build results (re-run them only if they haven't been run since the last change).
- From this session's own history: what broke, what took more than one attempt, what surprised you, where the docs were wrong or silent, and what is unfinished.
- Do not ask the user anything. Wrap-up is your own reflection on the session; record what got in the way from your own history.

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

## 4. Changelog and release
- If this PR changes anything a user or a connected agent can see, make sure `CHANGELOG.md` has a line for it under `## [Unreleased]`.
- If this slice **finishes a milestone**, cut the release in this PR: bump `package.json` to the milestone's version (M1 → 0.1.0 … M8 → 0.8.0), turn `[Unreleased]` into `## [x.y.0] — YYYY-MM-DD` with a fresh `[Unreleased]` above it, and tell the user to tag and publish the release after merging (CONTRIBUTING → Versioning and releases).

## 5. Promote what will bite again
- A gotcha that **any** future session could hit (tooling, environment, a library quirk) → add one line to the **Gotchas** section of `CLAUDE.md`. Keep that section under 15 lines; merge or drop stale lines rather than letting it grow.
- A gotcha about **one area** → put it in that area's doc (e.g. a Neon quirk in architecture → Environments).
- Code and docs disagree → fix the docs now (or use the `docs-sync` agent). If the code is what's wrong, list it under Follow-ups instead.
- Rotate the log: when `docs/dev-log.md` passes about 30 entries, move all but the latest 10 into `docs/dev-log-archive.md`.

## 6. Commit
Commit only the files above, to the current PR branch (never `main`), with the message `Wrap-up: <slice>`, and push. If auto-merge isn't on yet for this PR and the user didn't ask to hold it, enable it: `gh pr merge <n> --squash --auto --delete-branch`. Then tell the user, in two or three lines, where things stand and what the next session should start with.
