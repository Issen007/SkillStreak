# SkillStreak — Action Plan

This turns the README's roadmap into concrete next steps, and maps each
step to one of the specialized agents in `.claude/agents/`. See
[CLAUDE.md](CLAUDE.md) for full project context and constraints.

## The team

| Agent | Invoke as | Job |
|---|---|---|
| `architect` | subagent | System design decisions, ADRs, data model, API contracts |
| `ux-designer` | subagent | Flows, wireframes, screen copy |
| `frontend-developer` | subagent | Expo/React Native app |
| `backend-developer` | subagent | API, Postgres/Redis, Docker |
| `security-reviewer` | subagent | Security + GDPR/child-privacy compliance review |
| `code-critic` | subagent | Skeptical second-opinion review before merge |
| `ide-buddy` | subagent | Default day-to-day pairing/debugging |

To use one, ask for it by name (e.g. "have the architect draft an ADR for
the backend framework choice") and it'll run as a subagent with the role's
focus baked in.

## Phase 0 — Foundations (before writing app code)

- [ ] **Decide the app name** (owner: you + community — see README banner
      for candidates). Blocks nothing technical, but do it before it's
      wired into package names/bundle IDs. Still open.
- [x] **architect**: write ADR-0001 deciding NestJS vs FastAPI for the
      backend. → `docs/adr/0001-backend-framework.md`, decision: NestJS.
- [x] **architect**: write ADR-0002 for the initial data model — Team,
      Player, Coach, Streak, TeamSeasonPot, Badge — noting what lives in
      Postgres vs Redis and why. → `docs/adr/0002-data-model.md`.
- [x] **backend-developer**: scaffold repo structure, `Dockerfile` +
      `docker-compose.yml` (Postgres + Redis + API service). → `backend/`
      NestJS app with a `/health` endpoint; verified live end-to-end
      (`docker compose up`, all three services healthy, `/health` responds).
- [x] **security-reviewer**: review the Phase 0 data model and Docker setup
      before any real schema/migrations are written. Confirmed finding
      fixed: Postgres/Redis ports were bound to all host interfaces —
      now bound to `127.0.0.1` in `docker-compose.yml`. Three PLAUSIBLE
      data-model gaps flagged for Phase 1, before ADR-0002 becomes real
      schema:
      - [ ] Isolate `real_name` as structurally as `ParentalConsentRecord`
            is isolated (currently just a nullable column with a
            visibility *convention*, not an enforced boundary).
      - [ ] Reconsider whether `parental_consent_status` should gate
            account creation itself for the youngest players, not only
            media upload.
      - [ ] Constrain `BadgeAward.context` (currently freeform text/JSON)
            so it can't become a backdoor for location/PII the rest of
            the model deliberately excludes.

**Phase 0 is done** except the app name, which isn't a technical blocker.

**Follow-up (2026-07-03):** package-manager standard set in
`docs/adr/0003-package-managers.md` — pnpm for Node/TS (now: `backend/`;
later: the Expo app), uv for any future Python service. `backend/` migrated
from npm to pnpm (Dockerfile, lockfile); rebuilt and smoke-tested via both
`docker build` and a full `docker compose up` + `/health` check. Added
`.github/workflows/ci.yml`: backend lint/build/unit/e2e tests, a Dockerfile
build check, and a docker-compose smoke test, on every PR into `main` and
push to `main`. Making that check *required* before merge is a GitHub
branch-protection setting, not a repo file — see CLAUDE.md.

## Phase 0.5 — Hello World & Visual Identity

Not part of the README's Fas numbering — a small, deliberately narrow phase
to prove the toolchain works end-to-end and lock a visual identity *before*
any real screen gets built on top of it. Nothing here is functional; it's a
walking skeleton plus one mockup.

- [ ] **ux-designer**: propose a small style guide — color palette + font
      pairing for the brand (energetic/kid-friendly, works with the
      streak/fire and team-gold themes, high contrast for accessibility).
      Record it in `docs/design/style-guide.md`.
- [ ] **ux-designer**: build one mockup of the app's first screen (splash or
      home) applying that palette/fonts, as an HTML artifact — this is the
      "first slide" the rest of the app's look will be judged against.
- [ ] **frontend-developer**: scaffold the Expo app and get a literal
      hello-world screen running in a simulator/Expo Go — confirms the
      Expo/TypeScript toolchain actually works on this machine. Once the
      ux-designer's mockup is approved, reskin that one screen to match it
      (real colors/fonts, still no real functionality).
- [ ] **backend-developer**: scaffold the API service with a single health
      check endpoint (e.g. `GET /ping`) wired into `docker-compose.yml` with
      Postgres + Redis — confirms all three containers actually start and
      talk to each other, before any real schema exists.

**Definition of done:** `expo start` shows the on-brand first screen on a
device/simulator; `docker-compose up` brings up API+Postgres+Redis and
`/ping` responds; palette/fonts are written down in
`docs/design/style-guide.md` for reuse in Phase 1. No streak logic, no
auth, no real data yet — that's Phase 1.

## Phase 1 — MVP (README's "Fas 1")

Goal: a player can tap "Jag har tränat", see their personal streak
increment, and see the team's shared point pool increment.

- [ ] **backend-developer**: implement the Team/Player/Coach schema as
      migrations; implement streak logic (Redis) and team pool logic
      (Postgres) as separate modules per the architect's ADR.
- [ ] **ux-designer**: design the onboarding + parental-consent flow, and
      the core "Jag har tränat" screen (streak view + team meter).
- [ ] **frontend-developer**: scaffold the Expo app; build the onboarding
      and core screen against the UX spec and the backend API contract.
- [ ] **security-reviewer**: review the parental-consent flow and the
      player identity model (screen names) before this phase is
      considered done — this is the first phase that touches real child
      accounts.
- [ ] **code-critic**: review the streak/team-pool logic and the core
      screen's client code before merge (edge cases: first-ever streak
      day, midnight rollover, missed day, concurrent team-pool writes).

**Definition of done:** `docker-compose up` brings up the full stack; a
player can complete the core loop end-to-end; the schema and consent flow
have passed security review.

## Phase 2 — Coach tools & challenges ("Fas 2")

- [ ] **ux-designer**: design the coach dashboard and challenge-builder
      flow (e.g. "Gör 50 zorro-finter innan fredag").
- [ ] **backend-developer**: challenge CRUD + assignment to a team; VM-Guld
      meter aggregation.
- [ ] **frontend-developer**: coach view; player-facing challenge card and
      progress meter.
- [ ] **code-critic** + **security-reviewer**: review before merge, as in
      Phase 1.

## Phase 3 — Media & social ("Fas 3")

This phase is the highest privacy risk (video, a feed, tagging teammates) —
treat `security-reviewer` involvement as blocking, not a final check.

- [ ] **architect**: ADR for video storage/serving (where clips live, how
      access is scoped to a single team, retention/deletion), and — if the
      validity/tagging feature actually needs local ML — the new Python
      service's shape, built with uv per `docs/adr/0003-package-managers.md`.
- [ ] **security-reviewer**: sign off on the storage/access design *before*
      backend-developer builds it, not after.
- [ ] **ux-designer**: design the safe feed and the "tag a teammate to
      challenge them" flow.
- [ ] **backend-developer**: upload endpoint gated on parental consent;
      team-scoped feed API.
- [ ] **frontend-developer**: capture/upload UI, feed screen.
- [ ] **code-critic** + **security-reviewer**: final review before merge.

## Phase 4 — Kubernetes & public launch ("Fas 4")

- [ ] **architect**: Helm chart / K8s manifest design — only start this
      once Phases 1–3 are stable; don't let this pull effort forward.
- [ ] **backend-developer**: implement manifests, CI/CD for deploys.
- [ ] **security-reviewer**: production-hardening pass (secrets management,
      network policy, rate limiting) before any public rollout.

## Standing practice, every phase

- Every PR that touches auth, media, or child data goes through
  **security-reviewer** before merge — not optional, per CLAUDE.md.
- Non-trivial changes get a **code-critic** pass before merge.
- Default to **ide-buddy** for anything that doesn't clearly need a
  specialist — don't over-invoke agents for small stuff.
