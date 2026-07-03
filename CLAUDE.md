# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project status

Phase 0 (Foundations) is done — see [ACTION_PLAN.md](ACTION_PLAN.md) for the
live checklist. `docs/adr/` has the backend-framework and data-model
decisions, and `backend/` has a scaffolded NestJS app (health-check only,
no schema yet) wired to Postgres + Redis via `docker-compose.yml`. Phase
0.5 (Hello World & Visual Identity) is next. There is now some real
architecture to preserve (the ADRs, the scaffold) — don't treat this repo
as a blank slate the way earlier sessions could.

The project itself is also unnamed ("SkillStreak" is a working title — see
README banner for name candidates: SkillFlex, FloorGrind, StreakUp, ZorroGo,
SquadPulse). Don't hardcode the working title into code/config in a way
that's painful to rename later.

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
README's Privacy by Design section) before anything else:

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

## Planned tech stack (not yet implemented — confirm before assuming code exists)

- **Frontend:** React Native + Expo, TypeScript. Target iOS + Android from
  one codebase.
- **Backend:** NestJS (TypeScript) — decided in
  [`docs/adr/0001-backend-framework.md`](docs/adr/0001-backend-framework.md).
  Scaffolded in `backend/` (health-check endpoint only so far).
- **Database:** PostgreSQL (teams/players/coaches) + Redis (streaks,
  real-time leaderboards).
- **Infra:** Docker/docker-compose now; Kubernetes (Helm charts) is a
  Fas 4 goal, not needed for MVP.

## Roadmap (from README)

- **Fas 1 (current):** repo + Docker setup; DB schema for
  Team/Player/Coach (GDPR-compliant, supports both individual and team
  scoring); first React Native screen — a "Jag har tränat" (I trained)
  button that starts a streak and adds points to the team pool.
- **Fas 2:** coach view for sending challenges; streak logic on the
  backend; team "VM-guld" meter.
- **Fas 3:** secure video upload + team-bound feed.
- **Fas 4:** Helm/K8s manifests; international rollout.

When asked to "start building" or "what's next," default to the first
unchecked item in [ACTION_PLAN.md](ACTION_PLAN.md) (which includes a
Phase 0.5 ahead of Fas 1 proper) unless told otherwise.

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

See [ACTION_PLAN.md](ACTION_PLAN.md) for how these map onto the Fas 1–4
roadmap.

## Language notes

Product content and the README are in Swedish (target users: Swedish youth
floorball teams/coaches). Default to English for code, comments, commit
messages, and this kind of planning doc unless told otherwise — but
user-facing app strings will need Swedish, and the app will likely need
i18n rather than hardcoded Swedish or English text.

## Git workflow rule

**Never merge into `main` and never push directly to `main`** — this
applies to Claude Code and to every subagent in `.claude/agents/`. All work
happens on a branch (e.g. `phase0`, `phase1`); push the branch and leave
reviewing/merging to the project owner.

## Open decisions to surface, not silently pick

- Final app name (still open — see README banner for candidates).
- Three data-model gaps flagged by security-reviewer during the Phase 0
  review, tracked in [ACTION_PLAN.md](ACTION_PLAN.md)'s Phase 0 section,
  to resolve before ADR-0002 becomes real schema in Phase 1: isolating
  `real_name`, whether consent should gate account creation (not just
  media) for the youngest players, and constraining `BadgeAward.context`
  from becoming a freeform PII/location backdoor.
