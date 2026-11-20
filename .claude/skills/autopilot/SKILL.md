---
name: autopilot
description: Build Sound Journal slices back to back with no manual PR approvals. Each slice runs in a fresh subagent on its own model and effort, opens a PR, gets reviewed by the Opus pr-reviewer where it matters, and auto-merges when checks pass. Stops only for human steps, repeated failures or doc ambiguity. Usage: /autopilot [until <slice>]
disable-model-invocation: true
---

# Autopilot

You are the orchestrator. Stay light: you pick slices, launch one subagent per slice, wait for merges, and report. You never write app code yourself. Run this session on `sonnet` at `low` effort.

Argument: `until <slice>` (e.g. `until M4c`) sets where to stop. With no argument, stop after the next milestone completes.

## 0. Preflight (once)
- `gh auth status` works, `git status` is clean, you're on `main`, then `git pull`.
- `gh api repos/{owner}/{repo} --jq .allow_auto_merge` is `true`. If not, stop and tell the user: Settings → General → Pull Requests → tick **Allow auto-merge** and **Automatically delete head branches**.
- The ruleset on `main` requires both CI checks (`Validate taxonomy` and `Typecheck, lint, test, build`). If only one is required, stop and tell the user to add the other in Settings → Rules → Rulesets → protect main — auto-merge is only as safe as the required checks.
- If the newest version in `CHANGELOG.md` has no GitHub release yet, publish it (step 5).
- Read the status table in `docs/build-plan.md` and the top entry of `docs/dev-log.md`.

## 1. Pick the next slice
The first ☐ row in the build-plan table, in order. Skip "review" rows — reviews happen inside each slice (step 3).

**Human steps:** if the slice's Human steps column isn't "—", ask the user once whether it's done (e.g. "M2a needs Neon added in Vercel — done?"). Wait for a yes. Never try to do account sign-ups, payments or secret entry yourself.

## 2. Launch the slice in a fresh subagent
Use the slice's **Model** and **Effort** columns:
- `sonnet` / `haiku` → one `general-purpose` subagent with that `model` and `effort`.
- `opusplan` → first a `Plan` subagent on `opus` at the slice's effort to write the plan to `docs/features/<slice>-plan.md`; then a `general-purpose` subagent on `sonnet` at `medium` to implement it.

Brief the implementing subagent with exactly this (fill in the slice):

> You are building slice <SLICE> of Sound Journal, unattended. Read CLAUDE.md, README.md, the <SLICE> row of docs/build-plan.md (and docs/features/<SLICE>-plan.md if it exists), and only the docs that row lists. Skip the CLAUDE.md model check — the orchestrator already chose your model. Do not wait for plan approval: write a short plan into the PR description instead.
> Branch from an up-to-date main (`feat/<slice>-<short-name>`). Implement. Run typecheck, lint, tests and build until all pass. Delegate bounded pieces to the project agents in .claude/agents/ where the build plan names them.
> Before opening the PR, do the wrap-up steps from .claude/skills/wrap-up/SKILL.md yourself (status → ◐ with the PR number, dev-log entry at the top, changelog line if user-visible, gotchas promoted, release bump if this slice finishes a milestone), committed to the same branch.
> Open the PR with the template (`gh pr create --fill` is fine locally; body must follow the template). Do NOT merge it. Report: PR number, what shipped, tests run, anything ambiguous in the docs.
> If the docs are ambiguous in a way that changes behavior, stop and report the question instead of guessing.

## 3. Review gate
For slices that touch schema, auth, deletion or search sync (M2a, M2b, M3, M5a, M5b, M5c, M6b), run the `pr-reviewer` agent on the PR. If it reports **blocking** findings, launch a `general-purpose` sonnet subagent to fix exactly those on the same branch, then re-run the reviewer once. Should-fix items go in the PR description as follow-ups. Still blocking after one fix round → stop and report.

## 4. Merge automatically
`gh pr merge <n> --squash --auto --delete-branch`. GitHub merges it the moment the required checks pass (the ruleset still enforces them). Poll `gh pr view <n> --json state,statusCheckRollup` every ~30s:
- `MERGED` → `git checkout main && git pull`, then tick the slice ☑ in your summary (the ◐ → ☑ flip happens in the next slice's PR).
- A check fails → one `general-purpose` sonnet subagent fixes it on the branch. Fails again → stop and report.

## 5. Release
If the merged slice finished a milestone (its PR bumped `package.json`), publish the release:
`gh release create v<x.y.0> --target main --title "v<x.y.0>" --notes "<that version's CHANGELOG section>"`.

## 6. Loop or stop
Go to step 1 until you reach the `until` slice. Stop and report at once when: a human step is pending, CI fails twice, a blocking review finding survives a fix round, a subagent reports a doc ambiguity, or anything would touch production data or secrets.

## Final report (keep it short)
Slices merged (with PR links), releases published, anything stopped on and why, and the exact next human step if there is one.
