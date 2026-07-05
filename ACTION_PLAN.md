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
      - [x] Isolate `real_name` as structurally as `ParentalConsentRecord`
            is isolated (currently just a nullable column with a
            visibility *convention*, not an enforced boundary). Resolved:
            new `PlayerPrivateInfo` table (also absorbs `parent_contact`
            for the same reason) — see ADR-0002's 2026-07-03 addendum.
      - [x] Reconsider whether `parental_consent_status` should gate
            account creation itself for the youngest players, not only
            media upload. Resolved: gates the first `TrainingLogEntry`
            (real gameplay/data processing), not the onboarding shell
            (team join + profile) — see ADR-0002's addendum §2. Age-band
            nuance (13+ self-consent under Swedish GDPR Art. 8) flagged
            for security-reviewer to confirm before Fas 1 ships.
      - [x] Constrain `BadgeAward.context` (currently freeform text/JSON)
            so it can't become a backdoor for location/PII the rest of
            the model deliberately excludes. Resolved: fixed
            `trigger_reason` enum + a small allow-listed field set per
            reason, enforced at the API/DTO boundary — see ADR-0002's
            addendum §3.

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

**Follow-up (2026-07-03):** **architect** closed the three Phase 0 data-model
gaps above and defined the Phase 1 API contract ahead of real migrations →
`docs/adr/0002-data-model.md`'s addendum (real_name/parent_contact
isolation, consent gating point, BadgeAward.context shape) and
`docs/api/phase1-contract.md` (onboarding sequence, "Jag har tränat"
endpoint, home-screen fetch) — for backend-developer/frontend-developer/
ux-designer to build against directly rather than re-deriving from
ADR-0002 alone.

## Phase 0.5 — Hello World & Visual Identity

Not part of the README's Fas numbering — a small, deliberately narrow phase
to prove the toolchain works end-to-end and lock a visual identity *before*
any real screen gets built on top of it. Nothing here is functional; it's a
walking skeleton plus one mockup.

- [x] propose a small style guide — color palette + font
      pairing for the brand (energetic/kid-friendly, works with the
      streak/fire and team-gold themes, high contrast for accessibility).
      → `docs/design/style-guide.md` (flame/gold/ink/paper/success tokens,
      Baloo 2 + Nunito).
- [x] build one mockup of the app's first screen (home) applying that
      palette/fonts → `docs/design/home-screen-mockup.html` (Artifact
      hosting was unreachable — DNS failures to `api.anthropic.com` — so
      this is a self-contained local HTML file instead of a hosted link;
      retry hosting it later if useful, not blocking).
- [x] **frontend-developer**: scaffold the Expo app and get a literal
      hello-world screen running, styled with the approved palette/fonts.
      → `mobile/` (Expo, TypeScript). Confirmed working on a physical phone
      via Expo Go after a real snag: the project's initial SDK 57 didn't
      match the phone's installed Expo Go build (SDK 54) — Expo Go only
      supports one SDK per app-store release, updating the app doesn't
      change that. Downgraded `mobile/` to SDK 54 (react-native 0.81.5,
      react 19.1.0) via `expo install --fix`; typecheck, `expo-doctor`
      (18/18), and iOS+Android bundle all verified before handing back.
- [x] **backend-developer**: scaffold the API service with a single health
      check endpoint wired into `docker-compose.yml` with Postgres + Redis.
      → done in Phase 0 already (`/health`), nothing further needed here.

**Definition of done:** met — Expo Go on a real device shows the on-brand
home screen; `docker-compose up` brings up API+Postgres+Redis and
`/health` responds (Phase 0); palette/fonts are written down in
`docs/design/style-guide.md` for reuse in Phase 1. No streak logic, no
auth, no real data yet — that's Phase 1, starting now.

## Phase 1 — MVP (README's "Fas 1")

Goal: a player can tap "Jag har tränat", see their personal streak
increment, and see the team's shared point pool increment.

- [x] **backend-developer**: implement the Team/Player/Coach schema as
      migrations (including the `PlayerPrivateInfo` split and the
      constrained `BadgeAward.context` shape from ADR-0002's addendum);
      implement streak logic (Redis) and team pool logic (Postgres) as
      separate modules per the architect's ADR; implement the endpoints in
      `docs/api/phase1-contract.md`, including the consent gate on
      `TrainingLogEntry` creation. → TypeORM, full schema + seed script;
      verified live against `docker compose` (migrations, seed, full
      onboarding→consent-gate→training-log curl walkthrough).
- [x] **ux-designer**: design the onboarding + parental-consent flow
      (including the "waiting for parent approval" home-screen state), and
      the core "Jag har tränat" screen (streak view + team meter) — against
      `docs/api/phase1-contract.md`. → `docs/design/phase1-flows.md` +
      `docs/design/phase1-mockup.html`.
- [x] **frontend-developer**: scaffold the Expo app; build the onboarding
      and core screen against the UX spec and `docs/api/phase1-contract.md`.
      → `mobile/src/` (onboarding O1-O6, home H1/H3/H4/H2/H5/H6); verified
      against the live backend via a Node harness exercising the real API
      client code.
- [x] **security-reviewer**: review the parental-consent flow and the
      player identity model (screen names) before this phase is
      considered done — this is the first phase that touches real child
      accounts. Specifically confirm the age-band nuance flagged in
      ADR-0002's addendum §2 (13+ self-consent under Swedish GDPR Art. 8).
      → Backend pass: one CONFIRMED finding (no rate limiting on the two
      unauthenticated routes — fixed). Age-band question resolved: parent
      consent for every player in Phase 1, deliberately (ADR-0002
      addendum). Mobile-client follow-up pass: no findings. 180-day JWT
      with no revocation/reissue flagged as an acceptable Phase 1 gap,
      tracked below for Phase 2.
- [x] **code-critic**: review the streak/team-pool logic and the core
      screen's client code before merge (edge cases: first-ever streak
      day, midnight rollover, missed day, concurrent team-pool writes; the
      same-day-logging rule is now fixed in `docs/api/phase1-contract.md`,
      check the implementation actually matches it). → Backend pass: core
      loop correct (verified live with a 20-concurrent-request test against
      real Postgres), 5 lower-severity findings fixed (unscoped
      unique-violation catch, missing format validation, no automated
      concurrency regression test, untested BadgeAwardContext DTO). Mobile
      pass: 2 confirmed bugs (SecureStore-failure hang, missing 401
      handling on training-log submit) + 3 edge cases, all fixed.

**Definition of done:** met. `docker-compose up` brings up the full stack;
a player can complete the core loop end-to-end (onboarding → consent gate
→ "Jag har tränat" → streak + team pool update, same-day rule included);
schema and consent flow have passed security review, backend and mobile
client have both passed code-critic review.

**Follow-ups tracked for Phase 2, deliberately not fixed now:**
- JWT lifetime (180 days) has no revocation/reissue path — add a
  `tokenVersion` check + coach-facing "reissue this player's session"
  action alongside the Phase 2 coach dashboard.
- `docker-entrypoint.sh` only runs migrations, not the seed script — a
  fresh `docker compose up` has no invite code until someone runs
  `pnpm run seed` manually inside the container. Fine for local dev today;
  worth revisiting once there's a real coach-facing team-creation flow
  (Phase 2) that makes seed data unnecessary rather than automating it.
- `TeamPoolService.getActivePotForTeam` has no DB-level uniqueness
  guard against two simultaneously-"active" pots for one team — not
  reachable while pot creation is seed-only, but relevant once Phase 2
  builds season rollover.

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
