# SkillStreak — Action Plan

This turns the README's roadmap into concrete next steps, and maps each
step to one of the specialized agents in `.claude/agents/`. See
[CLAUDE.md](../CLAUDE.md) for full project context and constraints.

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
      backend. → `adr/0001-backend-framework.md`, decision: NestJS.
- [x] **architect**: write ADR-0002 for the initial data model — Team,
      Player, Coach, Streak, TeamSeasonPot, Badge — noting what lives in
      Postgres vs Redis and why. → `adr/0002-data-model.md`.
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
`adr/0003-package-managers.md` — pnpm for Node/TS (now: `backend/`;
later: the Expo app), uv for any future Python service. `backend/` migrated
from npm to pnpm (Dockerfile, lockfile); rebuilt and smoke-tested via both
`docker build` and a full `docker compose up` + `/health` check. Added
`.github/workflows/ci.yml`: backend lint/build/unit/e2e tests, a Dockerfile
build check, and a docker-compose smoke test, on every PR into `main` and
push to `main`. Making that check *required* before merge is a GitHub
branch-protection setting, not a repo file — see CLAUDE.md.

**Follow-up (2026-07-03):** **architect** closed the three Phase 0 data-model
gaps above and defined the Phase 1 API contract ahead of real migrations →
`adr/0002-data-model.md`'s addendum (real_name/parent_contact
isolation, consent gating point, BadgeAward.context shape) and
`api/phase1-contract.md` (onboarding sequence, "Jag har tränat"
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
      → `design/style-guide.md` (flame/gold/ink/paper/success tokens,
      Baloo 2 + Nunito).
- [x] build one mockup of the app's first screen (home) applying that
      palette/fonts → `design/home-screen-mockup.html` (Artifact
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
`design/style-guide.md` for reuse in Phase 1. No streak logic, no
auth, no real data yet — that's Phase 1, starting now.

## Phase 1 — MVP (README's "Fas 1")

Goal: a player can tap "Jag har tränat", see their personal streak
increment, and see the team's shared point pool increment.

- [x] **backend-developer**: implement the Team/Player/Coach schema as
      migrations (including the `PlayerPrivateInfo` split and the
      constrained `BadgeAward.context` shape from ADR-0002's addendum);
      implement streak logic (Redis) and team pool logic (Postgres) as
      separate modules per the architect's ADR; implement the endpoints in
      `api/phase1-contract.md`, including the consent gate on
      `TrainingLogEntry` creation. → TypeORM, full schema + seed script;
      verified live against `docker compose` (migrations, seed, full
      onboarding→consent-gate→training-log curl walkthrough).
- [x] **ux-designer**: design the onboarding + parental-consent flow
      (including the "waiting for parent approval" home-screen state), and
      the core "Jag har tränat" screen (streak view + team meter) — against
      `api/phase1-contract.md`. → `design/phase1-flows.md` +
      `design/phase1-mockup.html`.
- [x] **frontend-developer**: scaffold the Expo app; build the onboarding
      and core screen against the UX spec and `api/phase1-contract.md`.
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
      same-day-logging rule is now fixed in `api/phase1-contract.md`,
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

## Phase 2 — Kapten (team captain) & the weekly team goal ("Fas 2")

**Pivoted 2026-07-05**, mid-phase, after the project owner reviewed the
original coach-dashboard plan: no separate adult "Coach" login/dashboard.
Instead, one player per team is manually flagged as **Kapten** (captain) and
uses their *existing* player account to set a weekly team-wide goal; the
team gets a one-time point bonus when it's reached. This replaces (not
supplements) the coach-auth design below — kept in the history for
context, not as live direction.

- [x] **ux-designer**: design the coach dashboard and challenge-builder
      flow (e.g. "Gör 50 zorro-finter innan fredag"). →
      `design/phase2-flows.md` + `design/phase2-mockup.html`. Explicitly
      declined two non-UI decisions (coach authentication; the player
      session-reissue mechanism), correctly flagging them for architect.
      **Superseded by the pivot below** — its coach-dashboard framing and
      Part 3's individual-progress judgment call are no longer the
      direction; a follow-up ux-designer pass is still needed (see below).
- [x] **architect**: closed the two decisions ux-designer flagged, and
      formalized Phase 2's endpoint sketches into a real contract. →
      `adr/0004-coach-auth-and-session-reissue.md` (coach login:
      password-based, with the existing consent-mail infra reused only for
      password reset, not routine login; player session reissue: a
      `Player.token_version` column checked at JWT-verify time, plus a new
      coach-triggered, short-lived, human-typable one-time code — not the
      consent-token mechanism reused verbatim — that a kid enters on a new
      "lost your session" screen; coach and player tokens use separate
      guards/secrets, not a shared `JwtAuthGuard`) and
      `api/phase2-contract.md` (coach login/roster/dashboard, challenge
      CRUD, etc). **Parts 1-2 of that ADR (coach password auth, the
      separate coach JWT universe) are now superseded** — see below.
      Part 3 (player session reissue) is unaffected and stands as designed.
- [x] **architect**: redesigned Phase 2 around the pivot →
      `adr/0005-kapten-and-weekly-team-goal.md` (new): `Player.is_captain`
      boolean + a DB-level partial unique index enforcing one active
      captain per team, assigned manually (seed/admin action, same
      posture as Phase 1's team creation); the existing `Challenge` entity
      reused as "this week's goal" (renamed `created_by_coach_id` →
      `created_by_player_id`), progress flipped from individual to
      **team-wide** (`SUM(duration_minutes)` across every team member's
      logs in range — no `challengeId` tagging needed, that field stays
      dormant); a goal-completion bonus checked opportunistically inside
      the existing `POST /training-logs` transaction (no cron/K8s job),
      idempotent via a `goal_bonus_awarded_at` flag set under the same row
      lock used to detect the crossing. `api/phase2-contract.md` rewritten
      to match: no coach endpoints, `POST`/`PATCH .../weekly-goal` gated on
      captain status via a plain service-layer check (no new guard class),
      `GET` endpoints open to any teammate.
- [x] **Bonus-formula correction, 2026-07-05**: ADR-0005's first draft
      specified "+5 per log, retroactive-then-ongoing." That conflicted
      with the project owner's own note here in ACTION_PLAN.md ("+5p for
      each challenge and +1p for each minute of the challenge") — asked
      directly, the project owner confirmed the ACTION_PLAN wording is
      correct. **Final mechanic: a one-time lump sum — flat +5, plus 1
      point per team-wide minute logged toward the goal — paid once when
      the goal is first met**, not per-log or ongoing. Both
      `adr/0005-kapten-and-weekly-team-goal.md` (Decision 3) and
      `api/phase2-contract.md` (`POST /training-logs`'s `goalBonus`
      response field) updated to match; the transaction/idempotency
      structure itself didn't need to change, only the awarded-amount
      formula and the (now removed) "keeps paying after the crossing"
      branch.
- [ ] **ux-designer follow-up (not yet started)**: redesign
      `design/phase2-flows.md`'s Part 1 (drop the coach-dashboard framing
      entirely — a captain's screens live inside the ordinary player app,
      gated by `is_captain`, not a separate login surface) and Part 3 (the
      player-facing goal card is now a team-wide progress meter — closer
      to VM-Guld's gold meter than the individual flame meter it currently
      specifies — plus a celebratory moment for the one-time bonus, using
      `POST /training-logs`'s new `goalBonus` field). Also needs the new
      player-facing "enter your reissue code" screen (ADR-0004 Part 3,
      unaffected by the pivot but never designed in UI terms).
- [ ] **backend-developer**: implement `adr/0005-kapten-and-weekly-team-goal.md`
      and the corresponding parts of `api/phase2-contract.md` — captain
      flag/index, weekly-goal CRUD, team-wide progress computation, the
      goal-completion bonus inside the training-log transaction, plus
      ADR-0004 Part 3's session-reissue mechanism (unaffected by the
      pivot, still needed). **Do not build coach password
      login/`CoachAuthGuard`/bcrypt** — superseded, per above.
- [ ] **frontend-developer**: captain-only screens (weekly-goal
      create/edit, roster/consent view — gated on `is_captain`, using the
      existing player session, no new login screen), the team-wide goal
      progress card + bonus celebration for every player, and the new
      "enter your reissue code" screen. Build against the ux-designer
      follow-up above once it lands, not directly against the superseded
      `phase2-flows.md` Parts 1/3.
- [ ] **code-critic** + **security-reviewer**: review before merge, as in
      Phase 1. Auth (session reissue) and child data (roster, consent
      reminder) still make this security-reviewer-blocking, per CLAUDE.md
      — specifically flagged by architect: a **child captain** now
      triggers consent-reminder/session-reissue for a **teammate**, a
      different trust model than the original adult-coach version, worth
      an explicit sign-off rather than silently inherited.

## Phase 3 — Media & social ("Fas 3")

This phase is the highest privacy risk (video, a feed, tagging teammates) —
treat `security-reviewer` involvement as blocking, not a final check.

- [ ] **architect**: ADR for video storage/serving (where clips live, how
      access is scoped to a single team, retention/deletion), and — if the
      validity/tagging feature actually needs local ML — the new Python
      service's shape, built with uv per `adr/0003-package-managers.md`.
- [ ] **security-reviewer**: sign off on the storage/access design *before*
      backend-developer builds it, not after.
- [ ] **ux-designer**: design the safe feed and the "tag a teammate to
      challenge them" flow.
- [ ] **backend-developer**: upload endpoint gated on parental consent;
      team-scoped feed API.
- [ ] **frontend-developer**: capture/upload UI, feed screen.
- [ ] **code-critic** + **security-reviewer**: final review before merge.

## Phase 4 — Kubernetes & public launch ("Fas 4")

- [x] **backend-developer**: plain K8s manifests — pulled forward to
      2026-07-05 ahead of Phases 2–3, deliberately, to prepare for an early
      external beta. See "Pre-beta hardening pass" below for what shipped
      and what's still open (notably: no TLS yet).
- [ ] **architect**: Helm chart — not done; current manifests are plain
      YAML per the project owner's explicit request, not a rejection of
      Helm, just not needed yet.
- [ ] **security-reviewer**: full production-hardening pass (secrets
      management via a real secrets manager, network policy) — partially
      covered by the pre-beta pass below (rate limiting already existed
      from Phase 1), but not a complete Fas 4 pass.

## Pre-beta hardening pass (2026-07-05, ahead of Fas 2)

Not part of the Fas numbering — the project owner is beta-testing with real
users (starting with their own kids) sooner than the roadmap's phase order,
and asked for a real parental-consent email flow, a docs pass, a security/CVE
audit, and Kubernetes manifests to get there. Tracked here since it cuts
across several future phases.

- [x] Real SMTP (Google Workspace relay) wired up (`backend/src/mail/`),
      verified with a live auth test and a real email round-trip.
- [x] `GET`/`POST /api/v1/consent/:token` implemented — the parent-facing
      approval link the Phase 1 contract had only sketched. GET has no side
      effects (email-scanner prefetch safety), single-use token, row-locked
      approval. Verified live end-to-end including a real email to a real
      inbox.
- [x] Docs reorganized: `ACTION_PLAN.md` → `docs/ACTION_PLAN.md`, original
      pitch README → `docs/PROJECT.md` (FastAPI mention corrected to NestJS),
      new root `README.md` is a setup guide for a new user/beta tester, with
      an Early Alpha data-loss disclaimer and real device screenshots.
- [x] `k8s/` manifests (plain YAML, not Helm) — see Phase 4 above.
- [x] Full CVE/security audit (`security-reviewer`, cross-checked against
      `pnpm audit`/GHSA and OSV.dev independently) — findings and
      resolutions:
      - [x] `multer@2.1.1` (transitive via `@nestjs/platform-express`) —
            two DoS advisories (GHSA-72gw-mp4g-v24j, GHSA-3p4h-7m6x-2hcm).
            Not reachable yet (no upload endpoint until Fas 3) but fixed
            now via a `pnpm-workspace.yaml` override to `>=2.2.0` anyway.
      - [x] Real SMTP account/LAN IP were committed as *example* values in
            both `.env.example` files and `k8s/configmap.yaml` — replaced
            with generic placeholders (no password was ever committed).
      - [ ] **`k8s/ingress.yaml` has no TLS** — the consent-approval token
            is a bearer credential mailed to real parents; serving it over
            plain HTTP is a real problem, not a formality. Loudly flagged
            in `k8s/README.md` and `ingress.yaml` — **blocking** before
            this manifest set is ever applied against a real domain.
      - [ ] Two moderate CVEs in `mobile/`'s Expo/Metro *build tooling*
            (postcss via `@expo/metro-config`, uuid via `xcode`) — not
            shipped in the built app, no reachable runtime path. Deferred;
            revisit on the next Expo SDK bump.
      - [ ] 180-day JWT with no revocation/reissue (carried over from the
            Phase 1 review) — still an accepted gap, still tracked for
            Phase 2's coach dashboard.

## Standing practice, every phase

- Every PR that touches auth, media, or child data goes through
  **security-reviewer** before merge — not optional, per CLAUDE.md.
- Non-trivial changes get a **code-critic** pass before merge.
- Default to **ide-buddy** for anything that doesn't clearly need a
  specialist — don't over-invoke agents for small stuff.
