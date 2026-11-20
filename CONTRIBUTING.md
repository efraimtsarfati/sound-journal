# Engineering workflow

How changes get into Sound Journal. The goal: `main` is always deployable, every change is reviewable, and the docs always match the code.

## The rules

1. **Nobody commits directly to `main`.** Every change is a branch and a pull request.
2. **One PR, one purpose.** A milestone or a feature slice — not "misc fixes and also a new screen."
3. **Checks must pass before merging.** Typecheck, lint, tests, build.
4. **Test on the preview.** Every PR gets a Vercel preview URL. UI changes are checked on a phone.
5. **Docs change with the code.** If behavior changes, the matching doc changes in the same PR.
6. **No secrets in the repo.** Ever. The repo is public.

## Branches

| Prefix | For |
|---|---|
| `feat/` | new capability (`feat/capture-youtube`) |
| `fix/` | bug fix |
| `docs/` | documentation only |
| `chore/` | tooling, dependencies, CI |
| `refactor/` | restructuring with no behavior change |

Branch from an up-to-date `main`, keep branches short-lived (days, not weeks), and delete them after merging.

## Commits

Small and descriptive, imperative mood: `Add duplicate check for YouTube entries`. Explain *why* in the body when it isn't obvious.

## Pull requests

Every PR uses the template (`.github/pull_request_template.md`): what changed, why, how to test it on the preview, data/migration impact, docs updated. Squash-merge into `main` so each PR becomes one commit in history.

**Review:** the owner reviews every PR, even when an AI wrote it. Reviewing without reading code is legitimate: open the preview, run the "how to test" steps, check the docs diff, and confirm the checks are green.

## Checks (CI)

GitHub Actions runs on every PR and on `main`:

| Check | Command | Catches |
|---|---|---|
| Typecheck | `npm run typecheck` | type errors |
| Lint | `npm run lint` | style and common bugs |
| Unit tests | `npm test` | broken core logic |
| Build | `npm run build` | anything that wouldn't deploy |
| Taxonomy | validate `taxonomy/axes.json` | a broken taxonomy file |

Until the app skeleton exists (milestone M1), CI only validates the taxonomy file.

## Branch protection (public repo)

On GitHub Free, protected branches are available for public repositories. Set up once, under **Settings → Branches → Add branch ruleset** (or classic branch protection) for `main`:
- Require a pull request before merging
- Require status checks to pass (select the CI jobs once they exist)
- Block force pushes and deletions

## Secrets and environment variables

- Real values live in Vercel → Project → Settings → Environment Variables (separately for Production, Preview and Development).
- `.env.example` in the repo lists every variable **name** with a comment, never a value.
- Local development uses `.env.local`, which is git-ignored.
- If a secret is ever committed: rotate it immediately at the provider, then remove it from the code. Removing it from history is not enough on a public repo.
- Personal journal data never goes in the repo — no exports, no fixtures copied from real data.

## Database migrations

- Schema changes are Drizzle migrations in `lib/db/migrations`, generated with drizzle-kit and committed.
- Never edit a migration that has run in production; write a new one.
- Prefer **expand, then contract**: add the new column/table, migrate data, switch code over, and only remove the old column in a later PR.
- Every migration must run cleanly from an empty database. Once M2 lands, CI and unit tests apply all migrations to an in-memory PGlite database on every run — no secrets needed, so it works for PRs from forks.
- Deploys apply migrations automatically: the `vercel-build` script runs `drizzle-kit migrate` before `next build` (see architecture → Environments).
- Each PR's preview runs against its own Neon branch where possible, so migrations are tested on a copy of the data.

## Tests

- `lib/core` gets unit tests for every rule (status transitions, tag lifecycle, duplicate detection, scoping by `user_id`).
- Adapters (YouTube, MusicBrainz, vector index) are tested with recorded responses, not live calls.
- UI is tested by hand on the preview for v1.

## Definition of done

A PR is ready to merge when:
- [ ] Checks are green
- [ ] Tested on the preview (and on a phone for UI)
- [ ] Docs updated to match
- [ ] Migrations, if any, run from empty and are additive or follow expand/contract
- [ ] No secrets, no personal data, no stray debug code
- [ ] New dependencies are justified in the PR description

## Versioning and releases

Sound Journal uses [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

| Change | Before 1.0 | After 1.0 |
|---|---|---|
| A milestone completes | minor: `0.2.0` → `0.3.0` | — |
| A bug fix released on its own | patch: `0.3.0` → `0.3.1` | patch |
| New feature, backward compatible | minor | minor |
| Breaking change (data export format, MCP tool contract) | minor, called out in the changelog | major |

**Milestone → version:** M1 → `v0.1.0`, M2 → `v0.2.0`, … M8 → `v0.8.0`. **`v1.0.0` is cut when all eight acceptance criteria in `docs/spec-v1.md` pass on a phone.** M0 (docs only) is not released on its own; its changelog entries ship with `v0.1.0`.

**Every PR:** if the change is visible to a user or a connected agent, add a line under `## [Unreleased]` in `CHANGELOG.md` (Added / Changed / Fixed / Removed). Internal refactors and doc-only changes don't need one.

**Cutting a release** (done in the PR for the milestone's last slice, so `main` is never edited directly):
1. Set `"version"` in `package.json` to the new version.
2. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [0.3.0] — YYYY-MM-DD` and add a fresh empty `## [Unreleased]` above it.
3. Merge the PR.
4. Tag `main` and publish the release — either in GitHub (**Releases → Draft a new release → Choose a tag: `v0.3.0` → target `main`**, paste that version's changelog section, publish), or from a terminal: `git checkout main && git pull && git tag v0.3.0 && git push origin v0.3.0`, then publish the release notes in GitHub.

**Where the version shows:** `package.json` is the single source. `/api/health` returns it, the web app shows it in Settings, and the MCP server reports it in its server info, so you can always tell which version your phone or your agent is talking to. Vercel still deploys every merge to `main`; versions label meaningful points, they don't gate deploys.

## Decision records

Significant choices get a short record in `docs/decisions/` (`NNNN-title.md`): context, decision, consequences, alternatives considered. Records are never deleted; a reversed decision gets a new record that supersedes the old one.
