# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project status

Fas 1–3 are done; Fas 4 (Kubernetes & public launch) is in progress — see
`docs/internal/ACTION_PLAN.md` for the live English checklist
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

- **Closed team bubbles** — no data/video/comments public by default; a
  user only ever sees their own verified team, **except for a player's own
  clips, which they may publish only while that player's own parent has an
  active public-sharing consent** (ADR-0030). Amended by the project owner
  2026-08-18, closing ADR-0019's owner-only prerequisite.

  Three things that clause carries deliberately, and which no
  implementation may loosen: **the player's own** clips, never another
  child's; **their own parent**, never a captain, a coach, the operator or
  a team-level toggle — the variants ADR-0007, ADR-0010, ADR-0019
  Decision 2 and ADR-0029 Decision 9 each rejected independently; and
  **while active**, so the permission is a live state that lapses rather
  than a one-time event.

  Everything outside that clause is unchanged and still non-negotiable.
  Chat, training logs, real names and another child's clips never leave
  the team, consent or no consent.
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
1–6, prioritized order) and `docs/internal/ACTION_PLAN.md`
(English, phase-by-phase checklist with reasoning/review trail). Don't
restate phase contents here — they change often enough that a second copy
would just go stale; read those docs directly instead.

`docs/internal/` is **gitignored** — ACTION_PLAN.md, BACKLOG.md,
CONTINUE.md and FUTURE_IDEAS.md live only in the working tree, are not in
git history, and are not baked into the CI-built image. That is why they
are written as plain paths above rather than as links: a markdown link
would 404 for anyone reading this file on GitHub. It also means edits to
them are local-only and never show up in a commit or a PR diff.

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

See `docs/internal/ACTION_PLAN.md` for how these map onto the Fas 1–6
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
exception, even under direct instruction to do so. The `review` → `main`
merge is always the project owner's own action.

**`review` is the single integration branch, as of 2026-08-10.** Feature
branches merge into `review` (never directly into `main`) once they're
done — Claude Code may merge these itself, via a plain `git merge` +
`git push`. This is fine specifically because it's `review`, not `main` —
the rule above is unconditional and unaffected.

**One `review` → `main` merge per day, in the morning** (project owner's
decision, 2026-08-18). Work accumulates on `review` through the day and
ships in a single daily release rather than a merge per change — this
replaces the previous "when `review` has accumulated enough finished
work" cadence, which in practice meant several main merges a day and a
release pipeline run for each.

Claude Code **opens the `review` → `main` PR and hands over the link**;
the project owner merges it. That merge is what triggers the
versioning/release pipeline below. **Open the PR as soon as there is
something worth merging, without being asked** — on 2026-08-17 four
separate "I merged it to main" reports turned out to have merged nothing,
because the work had been pushed to `review` with no PR for the UI to
show. Twice that left production running code the owner believed had
shipped.

**Security fixes are the exception and do not wait for the morning.** If
a change closes a live vulnerability — anything touching child data,
media visibility, auth or consent — say so plainly and open the PR
immediately, flagging why it should not sit overnight. The daily cadence
exists to reduce release churn, not to delay a fix. The 2026-08-17 chat
clip embed gap (children's video served to accounts with no parental
consent, on teams that had not approved them) is the shape of thing this
carve-out is for.

*(Corrected 2026-08-10: this section previously said the `gh` CLI token
"cannot create or merge pull requests — a real, repeatedly-confirmed
limitation". `gh pr create` succeeded first try, opening PR #50, so the
creation half of that claim is simply false and was stopping sessions
from trying. Merging is untested and stays out of bounds anyway — by the
rule at the top of this section, not by any token limitation. If PR
creation ever does fail, record the actual error here rather than
restoring the blanket claim.)*

**`prerelease` is retired** (project owner's decision, 2026-08-10). It was
the integration branch from 2026-07-26 until then, and the two branches
had drifted into doing the same job. Nothing should push to it any more.
Three places still needed changing when it went, all done in the same
commit — if a fourth ever turns up, it belongs on this list: the CI
`push`/`pull_request` triggers, the `internal-images` job's ref check,
and `tools/local-release-poller/poll-and-deploy.sh`'s `BRANCH`. The
`prerelease-<sha>` **image tag** deliberately kept its name — it labels
the build *channel* ("an internal pre-release build"), not the branch, so
images already on GHCR and the version a running pod reports at `/health`
stay meaningful.

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
docker-compose smoke test on every PR into `main` (and into `review` too,
per the branch strategy above). The workflow file only
runs the checks — making them a *required* status check that blocks
merging is a GitHub branch-protection setting on the repo itself, not
something version-controlled here.

**This is now turned on** (verified 2026-08-19 against the live
`branches/*/protection` API; this section previously said it still needed
doing, which had gone stale). Both `main` and `review` require the same
four checks, with "require branches to be up to date" on:

  `Backend lint, build, test` · `Docker image builds` ·
  `clip-tagger lint + test` · `docker-compose smoke test`

Two consequences worth knowing before you plan a change:

- **`Mobile typecheck`, `Mobile expo-doctor` and `Mobile build drift` are
  NOT required** — the mobile side of a PR is advisory and cannot block a
  merge. Don't rely on CI to catch a broken `tsc`; run it yourself.

  **`Mobile build drift` is new (2026-08-21) and worth understanding**,
  because it reports something no other check can: whether the code in
  `mobile/` has run ahead of any app a person can actually install. CI
  builds and deploys the API and the site on every merge to `main`, and
  has never built the app — so the two drift apart silently. On
  2026-08-21 the installed build turned out to be three days and eleven
  commits stale, and the share button the owner was hunting for had never
  been in a build at all.

  It compares against `mobile/.last-eas-build.json`. To clear it: run an
  EAS build, then `cd mobile && node scripts/record-eas-build.mjs` and
  commit the result — the script asks EAS rather than taking your word
  for what was built. It is deliberately advisory (a blocking version
  would refuse the very commit it is asking for) and deliberately
  self-clearing, since permanent red is what taught everyone to ignore
  expo-doctor.
- **Strict mode means a stale branch is unmergeable**, so `review` may
  need `main` merged back into it before a PR will go green — which is
  the normal reason a PR that passed yesterday won't merge today.

No review approval is required on either branch, so the "never merge to
`main`" rule at the top of this section is still a policy this repo keeps
by hand, not something GitHub enforces.

## Environment parity — every URL/link must match wherever it's deployed

This project runs in exactly two places, per the Git workflow rule above:
**production** (`main` → the public `skillstreak` cluster, real
`https://skillstreak.xyz`/`api.skillstreak.xyz`/`try.skillstreak.xyz`
domains) and **internal test** (`review` → the `ubuntu01` microk8s
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

- ~~Final app name~~ — **decided 2026-08-10: SkillStreak**, per the
  Project status section above. Struck through rather than deleted so the
  closure is visible to anyone who remembers this as open.
  `docs/PROJECT.md`'s banner — which had gone on publicly soliciting name
  suggestions and listing five candidates long after the decision — was
  corrected to match on 2026-08-19.

  *(Nothing is open in this section right now. Keep the heading: it is
  where the next unresolved product call goes, and an empty list is a
  more honest signal than a deleted section.)*

(The three Phase 0 data-model gaps previously tracked here — isolating
`real_name`, consent gating account creation, constraining
`BadgeAward.context` — were resolved via ADR-0002's addendum and shipped
in Phase 1; see `docs/internal/ACTION_PLAN.md`'s Phase 0 section for the closed
checklist if that history is ever needed.)
