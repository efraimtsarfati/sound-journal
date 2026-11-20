# Dev log

Newest entry first. Written by the `wrap-up` skill at the end of every build session. A new session reads only the top entry. Recurring gotchas are promoted to `CLAUDE.md` or the relevant doc; this file is the history, not the rulebook.

---

## 2026-11-20 — M0 — Project documentation (PR #1)
**State:** done. Docs, taxonomy structure, CI stub, build plan, project agents and this skill are in PR #1.
**Next:** owner merges PR #1, turns on branch protection (ruleset on `main`: require PR with 0 approvals, require "Validate taxonomy", block force pushes), clones to `C:\Users\efrai\dev\sound-journal`; then start slice M1.
**Gotchas:**
- Remote tools can't write into a local `.github` folder and can't delete files, so git can't be run on the owner's machine remotely → GitHub is the source of truth; the owner clones locally.
- `gh pr create` fails from cloud sessions (GraphQL blocked) → use `gh api repos/{owner}/{repo}/pulls`.
- Keep the working copy out of OneDrive: syncing `.git` and `node_modules` causes sync errors.
**Follow-ups:** confirm Upstash hosted embeddings are free before M6; choose a license before inviting contributors.
