# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project status

Fas 1–3 are done; Fas 4 (Kubernetes & public launch) is in progress — see
[docs/ACTION_PLAN.md](docs/ACTION_PLAN.md) for the live English checklist
and [docs/PROJECT.md](docs/PROJECT.md) for the prioritized Swedish
roadmap. This is a real, substantial, working app already serving a live
beta on a real Kubernetes cluster — backend (NestJS), mobile (Expo), a
parental-consent/age-banded-self-verification email flow, team chat, a
video clip feed, self-service team creation. Don't treat this repo as a
blank slate; read those two docs before assuming what does or doesn't
exist yet, since both are updated far more often than this file.

**The app is called SkillStreak** — confirmed by the project owner
2026-08-10, no longer a working title. The bundle identifier and package
name (`xyz.skillstreak.app`, in `mobile/app.json`) encode it and are
permanent from first store publish, so this is settled rather than merely
current. The earlier caution about not hardcoding the working title is
withdrawn: hardcode it freely.

## What this is

A gamified activity app for youth floorball (innebandy) players, built by a
coach to pull kids' attention away from TikTok/Snapchat/Instagram and toward
daily training. Two parallel game modes:

1. **Individual series** — Duolingo-style personal streaks for logging
   10–15 min/day of training.
2. **Team series** — all players' logged sessions (fitness, floorball
   drills, running) add to one shared team point pool, chasing a virtual
   "VM-Guld" (World Championship Gold), independent of individual skill/age.

Plus: a safe internal short-clip feed (TikTok-style, team-only), auto-awarded
badges (Snapchat-style — "Best effort", "Most creative drill", not just
performance-based), a coach dashboard with a challenge builder, and an
LLM-backed feature for coaches to generate training plans from a prompt
("give me a fun 15-minute fitness session for 11-year-olds").

## Non-negotiable constraints — users are children (~9–13+)

Any feature touching accounts, media, or data must satisfy these (from the
docs/PROJECT.md's Privacy by Design section) before anything else:

- **Closed team bubbles** — no data/video/comments public by default; a user
  only ever sees their own verified team.
- **Anonymization option** — screen names (e.g. "FloorballStar15") must be
  usable instead of real names.
- **Parental approval flow** — required before any account can upload
  video/media.
- **No location tracking** — log *that* a child trained, never *where*.

Flag and push back on any implementation detail that would weaken these,
even if convenient (e.g. defaulting a feed to public, requiring real names,
adding geolocation for "nearby teams", etc.).

## Tech stack

- **Frontend:** React Native + Expo, TypeScript (iOS + Android, one codebase).
- **Backend:** NestJS (TypeScript), `backend/` — decided in
  [`docs/adr/0001-backend-framework.md`](docs/adr/0001-backend-framework.md).
- **Database:** PostgreSQL (teams/players/coaches — durable data) + Redis
  (streaks, leaderboards, rate limits — all rebuildable, never the only
  copy of anything, per ADR-0002).
- **Infra:** Docker/docker-compose + plain Kubernetes manifests (`k8s/`,
  pulled forward ahead of schedule for an early beta). Helm is a later
  Fas 4 goal, not needed yet.
- **Package managers:** pnpm for all Node/TypeScript code; uv for any
  future Python service (e.g. a video-tagging service) — decided in
  [`docs/adr/0003-package-managers.md`](docs/adr/0003-package-managers.md).
  Don't reintroduce npm/yarn or pip/poetry lockfiles alongside these.

## Roadmap

Full roadmap lives in [docs/PROJECT.md](docs/PROJECT.md) (Swedish, Fas
1–6, prioritized order) and [docs/ACTION_PLAN.md](docs/ACTION_PLAN.md)
(English, phase-by-phase checklist with reasoning/review trail). Don't
restate phase contents here — they change often enough that a second copy
would just go stale; read those docs directly instead.

When asked to "start building" or "what's next," default to the first
unchecked, actually-buildable item in those two docs (skip anything
blocked on something outside this repo, e.g. external infra access this
project doesn't control) unless told otherwise.

## Claude Code subagents for this project

Defined in `.claude/agents/`, one file per role. Invoke by name (e.g. "have
the architect draft an ADR for X"):

1. **architect** — system design decisions, ADRs, data model, API contracts.
   Not for implementation.
2. **ux-designer** — flows, wireframes, screen copy for the Expo app.
3. **frontend-developer** — React Native/Expo/TypeScript implementation.
4. **backend-developer** — API, Postgres/Redis, Docker Compose.
5. **security-reviewer** — security + the GDPR/child-privacy constraints
   above; blocking on anything touching auth, media, or child data.
6. **code-critic** — skeptical second-opinion review before merge; bugs,
   edge cases, over-engineering.
7. **ide-buddy** — default day-to-day pairing/debugging when nothing above
   clearly fits.

See [docs/ACTION_PLAN.md](docs/ACTION_PLAN.md) for how these map onto the Fas 1–6
roadmap.

## Language notes

Product content and docs/PROJECT.md are in Swedish (target users: Swedish youth
floorball teams/coaches). Default to English for code, comments, commit
messages, and this kind of planning doc unless told otherwise — but
user-facing app strings will need Swedish, and the app will likely need
i18n rather than hardcoded Swedish or English text.

## Git workflow rule

**Never merge into `main` and never push directly to `main`** — this
applies to Claude Code and to every subagent in `.claude/agents/`, with no
exception, even under direct instruction to do so. The `prerelease` →
`main` merge is always the project owner's own action.

**`prerelease` is the integration branch, added 2026-07-26.** Feature
branches merge into `prerelease` (not directly into `main`) once they're
done — Claude Code may merge these itself, via a plain `git merge` +
`git push` rather than a GitHub PR, since the `gh` CLI token available to
this project's Claude Code sessions cannot create or merge pull requests
(a real, repeatedly-confirmed limitation, not a policy choice). This is
fine specifically because it's `prerelease`, not `main` — the rule above
is unconditional and unaffected. When `prerelease` has accumulated enough
finished work, the project owner merges `prerelease` → `main` themselves;
that merge is what triggers the versioning/release pipeline below.

**Merging to `main` auto-versions and releases.** `.github/workflows/
ci-cd.yml`'s `release` job (triggered on push to `main`) bumps the version
(via git tags), creates a GitHub Release,
and builds/pushes Docker images tagged with that version to GHCR
(`ghcr.io/issen007/skillstreak-api`/`skillstreak-site`), alongside the
existing git-SHA-tagged images.

The bump **cascades at 9** (project owner's spec, 2026-08-09): `+0.0.1`
each merge, `v0.0.9` → `v0.1.0`, `v0.9.9` → `v1.0.0`. This is deliberately
**not** semver — it is a release counter in base 10, so the number says
"how far along are we" and carries no compatibility meaning. Don't
"correct" it back to `v0.0.10`.

Every image is stamped with what it was built from (`APP_VERSION` /
`EXPO_PUBLIC_APP_VERSION` build args): the release tag on a release build,
`main-<sha>` or `prerelease-<sha>` otherwise. `GET /health` returns it and
the app shows it at the bottom of the profile screen — so a *running* pod
can be asked what it actually is, which is exactly the check that would
have caught the 2026-07-30 wrong-image incident described below. A systemd timer on the local test machine
(`ubuntu01`) polls for new GitHub Releases and pulls/redeploys them to the
local microk8s cluster automatically — see `tools/local-release-poller/`
for that script and its systemd unit files.

`.github/workflows/ci-cd.yml` runs backend lint/build/test, a mobile
typecheck/expo-doctor pass, a Dockerfile build check, and a
docker-compose smoke test on every PR into `main` (and now into
`prerelease` too, per the branch strategy above). The workflow file only
runs the checks — making them a *required* status check that blocks
merging is a GitHub branch-protection setting on the repo itself, not
something version-controlled here. That still needs to be turned on
(Settings → Branches → branch protection rules for `main` and
`prerelease`) for "always tested before merge" to actually be enforced,
not just advisory.

## Environment parity — every URL/link must match wherever it's deployed

This project runs in exactly two places, per the Git workflow rule above:
**production** (`main` → the public `skillstreak` cluster, real
`https://skillstreak.xyz`/`api.skillstreak.xyz`/`try.skillstreak.xyz`
domains) and **internal test** (`prerelease` → the `ubuntu01` microk8s
cluster, LAN-only `192.168.55.x` addresses, no public DNS/TLS). Any change
that touches a URL, hostname, link, QR code, deep link, CORS origin, or
similar environment-specific value must work correctly in **both** places,
matching whichever one it actually lands on — never hardcode one
environment's value as if it were universal.

The existing mechanism for this is build-time, not runtime: `.github/
workflows/ci-cd.yml` builds **separate Docker images per environment**
(the `deploy`/`release` jobs bake the real domains for `main`; the
`internal-images` job bakes the `192.168.55.x` LAN addresses for
`prerelease`), and backend config comes from each cluster's own
`ConfigMap`/`Secret`, not a shared one. Reuse this pattern — don't invent a
second, runtime-detection mechanism alongside it. See `site/Dockerfile`'s
build-arg/placeholder scheme and the two CI jobs' differing `build-args`
for the existing convention to extend.

**Why this is called out explicitly**: confirmed live 2026-07-30 that
production's `site` Deployment was, for a stretch of time, running an
`internal-images`-built (`prerelease-<sha>`-tagged) image instead of the
correct `main`-built one — real visitors to `skillstreak.xyz`'s "Skaffa
appen" QR-code page saw an unreachable internal LAN IP
(`192.168.55.72:8081`) instead of the real domain. The two environments'
images were both correctly built by CI; something outside CI (most likely
the shared-kubeconfig/wrong-`kubectl`-context risk noted in this repo's
own handoff docs) pointed production at the wrong one. Before considering
any environment-touching change done, verify which image/config is
*actually* live on each cluster — don't assume the last CI run is what's
currently running.

## Open decisions to surface, not silently pick

- Final app name (still open — see docs/PROJECT.md banner for candidates).

(The three Phase 0 data-model gaps previously tracked here — isolating
`real_name`, consent gating account creation, constraining
`BadgeAward.context` — were resolved via ADR-0002's addendum and shipped
in Phase 1; see docs/ACTION_PLAN.md's Phase 0 section for the closed
checklist if that history is ever needed.)
