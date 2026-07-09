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
- [x] **ux-designer follow-up**: redesigned `design/phase2-flows.md` in
      place — Part 1 replaced entirely (no coach-dashboard framing; a
      captain's screens (K1 roster summary/entry, K2 full roster,
      K3 reissue-code display) live inside the ordinary "Laget" tab, gated
      client-side on `viewerIsCaptain`); Part 2 (KB1-KB4 goal builder)
      adapted to a team-wide target; Part 3 replaced with a team-wide gold
      progress meter (G1) and a role-split bonus celebration — a bigger
      team-crediting takeover for whoever's log crossed the threshold (G2)
      vs. a smaller one-time catch-up banner for every other player on next
      open (G3); new Part 4 (R1/R2) for ADR-0004 Part 3's session-redemption
      screen. Also caught and fixed a real accuracy bug in its own first
      draft: a proposed client-side derivation of the non-triggering
      viewer's bonus amount (`5 + targetValue`) was wrong per ADR-0005's
      actual formula — fixed by persisting `goalBonusPointsAwarded` on the
      goal record instead (see `api/phase2-contract.md`).
- [x] **backend-developer**: implemented `adr/0005-kapten-and-weekly-team-goal.md`
      and `api/phase2-contract.md` in full — captain flag/index, weekly-goal
      CRUD + state machine, team-wide progress computation, the
      goal-completion bonus inside the training-log transaction (persisting
      `goalBonusPointsAwarded`, not just the timestamp, per the mid-task fix
      above), and ADR-0004 Part 3's session-reissue mechanism. Verified
      independently (not just the implementing agent's own report): clean
      lint/build, unit + e2e tests, rerun against a fresh `docker-compose`
      Postgres/Redis. No coach password login/`CoachAuthGuard`/bcrypt was
      built, per the pivot.
- [x] **code-critic** + **security-reviewer**: ran after the code had
      already reached `main` (a process gap — this should have blocked the
      merge, not followed it; see "Branching process gap" below). Findings:
      - [x] **code-critic, CONFIRMED**: `title`/`description` were editable
            on `completed`/`cancelled` goals with no status check at all,
            contradicting the contract's "non-terminal status" rule. Fixed:
            new `ChallengeAlreadyTerminalException`, plus test coverage for
            `patchGoal` (there was none before — code-critic's own finding).
      - [ ] **security-reviewer, CONFIRMED CRITICAL — session-reissue allows
            full account takeover, not just impersonation risk.** The
            reissue code is returned directly to whoever calls
            `POST /players/:playerId/session-reissue` (intended to be
            relayed to the target player in person), but
            `POST /players/session/redeem` is unauthenticated and accepts
            the code from anyone — so the same captain who triggered
            reissue can immediately redeem it themselves and get a live
            session token **for the target player**, repeatedly, with no
            rate limit, no audit trail, and no notification to the
            affected player or their parent. Verified directly by reading
            the controller code, not taken on the reviewer's word alone.
            **Action taken**: both routes disabled (`SessionReissueDisabledException`,
            503 `session_reissue_disabled`) rather than shipping a partial
            fix — this reverts to Phase 1's already-accepted "180-day JWT,
            no revocation" state, not a new regression. `SessionService` and
            its logic are left intact (the `token_version`/single-use-code
            mechanism itself is sound) for a proper redesign later that
            binds redemption to the target player rather than to bearer
            possession of the code. **Still open, tracked in Phase 2.5.**
      - Everything else both reviewers checked — the bonus mechanic's
        idempotency (including under real concurrency), the weekly-goal
        state machine, captain authorization/IDOR scoping, the DB-level
        uniqueness constraints, SQL injection surface, PII/location
        exposure — came back clean.

**Branching process gap, noted so it isn't repeated:** Phase 2's work was
committed to the `phase1` branch (kept open from Phase 1) instead of its own
branch, and both `phase1` and (once split out) `phase2` were merged to
`main` before the code-critic/security-reviewer pass ran — the pass above
happened *after* merge, on a fresh `phase2-followup` branch, not before. The
critical session-reissue finding was caught and disabled promptly, but the
right process is: branch per phase, review before merge, every time.

- [x] **frontend-developer**: built the Hem/Mål/Laget tab bar (Phase 1
      never built one) wrapping K1/K2 (roster + consent view, gated on
      `viewerIsCaptain`, existing player session, no new login screen),
      KB1-KB4 (goal builder, with both the preemptive client-side guard
      and the server-side `409` fallback), G1 (team-wide gold progress
      card), and the G2/G3 bonus-celebration split (a bigger takeover for
      the triggering player, a smaller one-time catch-up banner + tab dot
      for everyone else, reading `goalBonusPointsAwarded` from the
      weekly-goal `GET` response rather than re-deriving it). Confirmed
      via grep: zero references anywhere in `mobile/src` to the disabled
      session-reissue/redeem feature — R1/R2 and K2/K3's reissue action
      were correctly skipped. Verified independently (clean
      `tsc`/`expo-doctor`, reviewed the celebration-split and KB4-guard
      logic directly) on top of the implementing agent's own live-backend
      verification against a seeded Postgres 18 instance.

**Phase 2 is functionally complete** (backend + frontend implemented,
reviewed; the session-reissue feature is a known, tracked, disabled gap
— not silently missing). Continuing directly into Phase 2.5 below, per
the project owner's instruction.

**Follow-up (2026-07-05), done ahead of the frontend work above:** Postgres
16 → 18, on branch `phase2-followup` (not yet merged). Real finding:
Postgres 18's official image changed its expected volume mount convention
(a single mount at `/var/lib/postgresql`, not `.../data`) to support a
future `pg_upgrade --link` path — mounting at the old location makes the
18+ image refuse to start. Fixed in `docker-compose.yml`,
`k8s/postgres-deployment.yaml`, and the CI workflow's service container.
Verified against a fresh instance (old volume wiped — a major-version bump
isn't binary-compatible with existing data directories, and there's no real
data yet to migrate): all migrations ran automatically via the entrypoint,
62 unit + 24 e2e tests pass, the seed script runs cleanly, `/health`
responds.

## Phase 2.5 — Verify and Security check ("Fas 2.5")

This phase is a deliberate pause after the Phase 2 pivot, to let the
architect and security-reviewer sign off on the new design before any
real media upload or social features are built. The project owner is
already beta-testing with real kids, so this is a *blocking* review, not a
final check.
Do also go though the code so it is documented and reviewed, but also see if we don't have code that could be optimized or reused so we don't have to write new code for the next phase.

- [x] **backend-developer**: added `backend/README.md` (module map, run
      instructions, dormant-module flags, pointers to ADRs/contracts —
      deliberately not duplicating them). Fixed several stale comments left
      over from the pre-kapten-pivot design (`season.entity.ts`,
      `coach.entity.ts`, `team-coach.entity.ts`, `badge-trigger-reason.enum.ts`,
      `points.util.ts`). Genuine reuse finding acted on: `onboarding.service.ts`
      and `weekly-goal.service.ts` each independently defined an identical
      "is this Postgres error a unique-violation on constraint X" helper —
      extracted into `backend/src/common/errors/postgres-error.util.ts`
      (`isPostgresUniqueViolation`), both call sites now share it. Verified:
      lint, build, 62/62 unit tests, 24/24 e2e tests all pass unchanged after
      the extraction.
- [x] **frontend-developer**: added `mobile/README.md` (module map, local-run
      instructions including the Expo-Go SDK-version gotcha, and a "known
      duplication / consolidation candidates" section — `CatchUpBanner`/
      `Toast`, shared loading/error boilerplate across `HomeScreen`/
      `TeamScreen`/`GoalScreen`/`RosterScreen`, and the `TeamPoolCard`/
      `GoalCard` progress-bar animation — flagged for before Phase 3 adds a
      third or fourth similar screen, not acted on now to avoid an
      unrequested refactor). Fixed a few stale/missing comments (`AppShell.tsx`'s
      G2/G3 suppression walkthrough, `PrimaryButton.tsx`, `AppHeader.tsx`).
      Confirmed via grep: zero references anywhere in `mobile/src` to the
      disabled session-reissue/redeem feature — the frontend never grew a
      dependency on it. Verified: `npx tsc --noEmit` clean, `npx expo-doctor`
      18/18.
- [x] **security-reviewer**: full sign-off — **safe to continue into Phase 3
      planning.** Re-confirmed the session-reissue disable holds end-to-end
      (controller, service reachability, e2e coverage, and the mobile client
      — zero live calls, zero UI affordance for it). Re-confirmed server-side
      authorization (not client trust) gates every mutating Phase 2 endpoint,
      no `real_name`/location exposure anywhere in the new roster/goal
      payloads, DTO whitelisting blocks field-smuggling, and the training-log
      write path has no IDOR (player ID always comes from the JWT, never a
      param). Two non-blocking findings, not gating Phase 3:
      - **Consent-reminder cooldown only bounds a 5-minute burst, not
        sustained volume** — an authenticated captain can force a real email
        to a teammate's parent roughly every 5 minutes indefinitely (~288/day),
        with no daily cap and no audit trail of resend counts. Confirmed as a
        genuine, traceable harassment vector against a real family inbox (not
        theoretical, since it requires a deliberate, identifiable actor).
        Recommended fix before scaling the beta wider: a daily cap per target
        (e.g. 3/day) plus a lightweight audit record. **Still open.**
      - **`localFlags`'s `lastSeenBonusAwardedAt` key is scoped by `goalId`
        only, not by player** — on a shared/handed-down device, a second
        player logging in after a first player already saw a goal's bonus
        celebration will silently miss their own one-time G3 banner. Cosmetic
        only (the value is just a timestamp, no PII, no cross-account data
        exposure) — recommended fix is to key by `${playerId}.${goalId}` and
        clear `localFlags` alongside `clearSessionToken()`. **Still open, low
        priority.**

**Phase 2.5 is complete — security-reviewer's sign-off is "safe to continue
into Phase 3 planning."** Two non-blocking, tracked findings remain open
(consent-reminder sustained-volume cap, `localFlags` per-player scoping);
neither needs to be fixed before Phase 3 starts, but both should land before
the beta scales beyond the current team. The session-reissue redesign is
also still open (see the Phase 2 section above) and remains deferred.

## Phase 2.6a — Capten of the team ("Fas 2.6a")

In the Team ("Laget") tab, you should see the entire team and who is the capten, but also be able to assign a new capten. This is a small phase to make sure that the capten is visible and can be assigned, but also to make sure that the capten can be removed and assigned to another player.

- [x] **architect**: designed the self-service transfer (current captain
      hands off to a named teammate, no other authority exists to do this —
      no coach account is reachable) and a new non-captain-gated "who's on
      my team, who's captain" view, without reopening ADR-0005's `is_captain`
      column/partial-unique-index design. →
      `adr/0006-captain-transfer.md` (transaction/row-lock shape mirroring
      `WeeklyGoalService.patchGoal`, deliberately not the plain two-`UPDATE`
      sketch ADR-0005 wrote for an out-of-band admin script) and
      `api/phase2-contract.md`'s 2026-07-08 addendum (`POST
      /teams/:teamId/captain-transfer`, `GET /teams/:teamId/teammates`).
      Flagged, not decided: whether either party gets an in-app notification
      of a transfer — left to ux-designer.
- [x] **ux-designer**: resolved the open notification question — the
      incoming captain gets a one-time celebratory banner (Screen K5),
      reusing `AppShell.tsx`'s existing "diff a locally persisted flag"
      mechanism already built for the weekly-goal bonus catch-up (no new
      backend). Teammates list becomes an always-visible baseline section
      on K1 (not folded into captain-only K2), deliberately non-tappable —
      the transfer action gets its own explicit entry point (K4) so a
      casual glance at the roster can't trigger it. →
      `design/phase2.6-2.7-flows.md` Part A,
      `design/phase2.6-2.7-mockup.html`.
- [x] **backend-developer**: `PlayersService.transferCaptaincy`/
      `listTeammates`, `isCaptain` added to the existing roster response,
      two new routes on `WeeklyGoalController`. Follows ADR-0006's exact
      row-lock order (requester, then target); verified independently
      (not just the implementing agent's report) by reading the
      transaction directly and via a dedicated concurrency e2e test
      (`captain-transfer-concurrency.e2e-spec.ts`). Lint/build/114 unit/55
      e2e tests all pass against a genuinely fresh Postgres 18 + Redis
      instance, re-run 4 times with no flakiness.

## Phase 2.6b — Team Chat ("Fas 2.6b")

In the team it should be a team chat where they can communicate with each other, but also be able to communicate with the capten. This is a small phase to make sure that the team chat is working and that the capten can communicate with the team, but also a way to help each other to continue their streak. This is a small phase to make sure that the team chat is working and that the capten can communicate with the team, but also a way to help each other to continue their streak.

- [x] **architect**: designed the message/report/block data model, a
      pluggable (interface-based) keyword-filter seam so the deferred
      LLM-moderation item in `docs/BACKLOG.md` can slot in later without a
      rewrite, and a poll-based (not WebSocket) fetch — a deliberate,
      justified "boring for this phase" call, not an oversight. →
      `adr/0007-team-chat.md`, `api/phase2.6b-contract.md`.
      **Explicitly flagged, not resolved**: there is no reliable, timely
      review path between a message being reported and any human acting on
      it — the design's best answer (best-effort, rate-limited emails to
      the reported player's own parent and, where on file, the team's
      dormant `Coach.email`, plus a personal per-viewer block) is a real
      mitigation, not a fix. Two alternatives were considered and
      deliberately rejected: auto-hiding a message after N reports, and
      giving the captain a team-wide hide action — both hand a peer more
      authority over another child's content than anything else in this
      app grants a peer. **security-reviewer sign-off on this specific
      gap is a blocking requirement before merge**, per CLAUDE.md and the
      ADR's own framing.
- [x] **ux-designer**: designed the chat screen (new "Chatt" tab, placed
      second in tab order by expected visit frequency), with report
      (tap-to-reveal on a teammate's message, not long-press — findable by
      a 9-year-old) and block (a different tap target, the sender's
      avatar/name) kept spatially and functionally separate per the
      contract's instruction. All copy — filter rejection, report reasons,
      report confirmation, block confirmation — written specifically to
      never overpromise a review guarantee ADR-0007 says this app can't
      deliver. → `design/phase2.6-2.7-flows.md` Part B,
      `design/phase2.6-2.7-mockup.html`. **Flagged a real contract gap**:
      no `GET .../chat/blocks` endpoint exists, so the block-management
      screen is client-cache-backed only (works on the device that made
      the block, not a fresh install/new device) — flagged for architect
      as a small, reasonable fast-follow, not invented here.
- [x] **backend-developer**: new `team-chat/` module (message/block/report
      entities + migration, the `ChatModerationCheck` DI seam with a
      Swedish keyword-list implementation, all 5 endpoints, Redis rate
      limits, the best-effort dual parent/coach notification email).
      Verified independently: the message-list query combines the
      `status != 'hidden'` filter and the per-viewer block filter in one
      query (read directly, not taken on trust — this is the one place a
      future refactor could silently leak a blocked/hidden message); the
      keyword-matcher is word-boundary-aware and evasion-resistant
      (Unicode-letter-aware for å/ä/ö, absorbs repeated-character and
      inserted-punctuation evasion) — read and reasoned through directly.
      Lint/build/unit/e2e all pass (see 2.6a's entry — one shared
      verification run covered all three phases together).
      **Flagged by the implementing agent, reviewed and accepted**: the
      send-rate-limit allowance is claimed *before* the moderation check
      (so repeated filter-probing still costs the sender's quota, not
      free); the "already reported" 409 check happens before claiming the
      report cooldown (a failing call doesn't burn the limit); every coach
      on file for a team gets the notification email, not just one
      (`TeamCoach` is many-to-many); content is trimmed before storage,
      which matches the contract's own "1-500 chars after trim" wording,
      not a deviation from "never mutated" (that clause is about
      content/censorship, not whitespace hygiene).

## Phase 2.6c — Create Goals in the team ("Fas 2.6c")
We need a easy way to create goals in the team, but also be able to see the goals that are created. This is a small phase to make sure that the goals are being created and that the goals are being displayed, but also a way to help each other to continue their streak. This is a small phase to make sure that the goals are being created and that the goals are being displayed, but also a way to help each other to continue their streak.

- [x] **ux-designer**: confirmed the existing goal builder/history (KB1-KB4,
      G1) already satisfy this phase's ask, per the project owner's own
      decision this session — proposed four small polish items instead of
      new screens/endpoints: surface `targetMetric` on the goal card so
      players know what training counts, promote "Se tidigare mål" above
      captain-only actions, show the final tally + bonus on completed
      history rows (data already in the response, just unused), and a
      small icon on the empty-goal state. → `design/phase2.6-2.7-flows.md`
      Part C.

## Phase 2.7 - VM-Guld 
You shouldn't have any maximum goal, instead that points should be compaired with other teams points and you should see a leading board when you click om Lagets VM-Guld-pott (that name need to be cahnged to something better). This is a small phase to make sure that the leading board is working and that the points are being compaired with other teams points, but also a way to help each other to continue their streak. This is a small phase to make sure that the leading board is working and that the points are being compaired with other teams points, but also a way to help each other to continue their streak.

- [x] **architect**: designed the cross-team query (joins only
      `team_season_pot`/`team` — structurally cannot reach `Player`/
      `PlayerPrivateInfo`), the `GET /teams/:teamId/leaderboard` contract,
      and the removal of `goalThreshold`/`percentComplete` from three
      already-shipped response shapes (`GET /players/me`, the dashboard,
      `POST /training-logs`) — a real breaking change, called out explicitly
      rather than left for frontend-developer to discover at runtime. →
      `adr/0008-vm-guld-cross-team-leaderboard.md`,
      `api/phase2.7-contract.md`. Decided explicitly rather than silently
      assumed: the per-team season-date-range mismatch
      `team-pool/entities/season.entity.ts` already flags is an **accepted,
      explicitly-flagged limitation** for the current beta scale, not a
      blocker — with a stated condition for when that stops being true.
      `TeamSeasonPot.goal_threshold` stays in the schema, dormant, not
      dropped (same posture as `Coach`/`TeamCoach`). New button copy
      (replacing "Lagets VM-Guld-pott") is flagged for ux-designer, not
      picked here.
- [x] **ux-designer**: renamed it to **"VM-Guld-tabellen"** — reuses the
      ordinary Swedish word for a sports league table (every kid already
      knows it from Allsvenskan/SHL), preserves the existing VM-Guld brand
      framing rather than discarding it. Designed the rewritten top-level
      card (number + rank, no progress bar — there's no threshold left for
      one to represent) and the full leaderboard screen (own team
      highlighted in natural sorted position, ties shown via simple rank
      repetition with a one-line explanatory caption shown only when a tie
      is present, graceful between-seasons/empty-leaderboard states). →
      `design/phase2.6-2.7-flows.md` Part D,
      `design/phase2.6-2.7-mockup.html`. Flagged for frontend-developer:
      Swedish ordinal suffixes (1:a/2:a/3:e/4:e...) need a real formatting
      helper, not a hardcoded suffix, per CLAUDE.md's i18n instruction.
- [x] **backend-developer**: `TeamPoolService.getLeaderboard`/
      `computeStandardCompetitionRanks`/`getRankAndTeamCountOrThrow` — the
      query joins only `team_season_pot`/`team`, verified directly by
      reading it (no `Player`/`PlayerPrivateInfo` join exists anywhere in
      it, matching the ADR's hard requirement structurally, not just by
      convention). New `GET .../leaderboard` route; breaking-change updates
      shipped to `GET /players/me`, the dashboard, and `POST
      /training-logs` exactly as ADR-0008 specified (`rank`/`teamCount`
      added to the first two only, dropped entirely from the third).
      `goal_threshold` column confirmed left in place, unused. Ranking
      algorithm (ties share rank, next distinct score skips) verified by
      tracing the implementation against the ADR's own worked example.
      Test suite includes a dedicated e2e file that deliberately uses
      well-separated point totals to stay deterministic despite the
      leaderboard being genuinely global/shared with other e2e fixtures —
      reviewed directly, a legitimate test-design choice, not weakened
      assertions.

- [x] **frontend-developer**: built all four sub-phases against the flow
      doc and the real, running backend. Part A: the always-visible
      teammates section on K1, Screen K4's captain-transfer flow (every
      contract error branch handled), and Screen K5's celebratory banner
      reusing `AppShell.tsx`'s existing catch-up-diff mechanism verbatim
      (including a correct "first time ever seen on this device" baseline
      case, so a fresh install doesn't mistake an existing captain for a
      newly-promoted one). Part B: the new "Chatt" tab (second in order),
      CH0-CH5 built to spec, with report/block correctly disabled on the
      viewer's own messages (verified directly in `MessageBubble.tsx` —
      `onPress={isOwn ? undefined : onTapBody}` and the sender row not
      rendered at all for own messages). Part C: all four goal-screen
      polish items. Part D: `TeamPoolCard` rewritten, the new leaderboard
      screen, and an isolated `swedishOrdinal` helper (verified correct
      against the 1/2/3/4/11/12/21/22/23 rule directly). Verified
      independently: `npx tsc --noEmit` and `npx expo-doctor` (18/18) both
      clean; the agent additionally exercised every new endpoint against a
      real running backend (seeded team, minted session token, captain
      transfer, chat send/poll/report/block/filter-rejection, leaderboard
      with real multi-tie data) before handing back — a stronger
      verification bar than a typical frontend pass in this project so far.
      **Two judgment calls flagged and reviewed, both accepted**: the
      "Chatt" tab's unread dot is a one-shot lightweight check in
      `AppShell`'s existing foreground-check cycle (not a continuous poll,
      which only runs while the tab itself is mounted) — resolves a real
      internal contradiction in the flow doc, not a deviation from intent.
      Screen LB1's "between-seasons, graceful card" state is currently
      unreachable through `GET /players/me`/the dashboard in practice,
      since `TeamPoolService.getActivePotForTeam` still throws a `500` for
      the *requesting* team's own missing pot — confirmed by reading that
      method directly: this is pre-existing Phase 1 behavior, unchanged by
      ADR-0008, not a regression introduced here. The frontend still built
      the graceful UI defensively (harmless, forward-compatible) since
      Screen LB2's identical between-season case *is* fully reachable and
      real (`requestingTeam: null`).

- [x] **code-critic**: reviewed the full batch (concurrency logic, the chat
      visibility query, keyword-matching regex, ranking algorithm, the
      mobile polling lifecycle) after independently re-running lint/build/
      unit/e2e/tsc/expo-doctor. **One CONFIRMED bug, fixed**: the keyword
      filter's multi-word entries (e.g. "fan ta dig") flattened the
      phrase's own spaces and rejoined every letter with the same flexible
      separator used for within-word evasion — making the banned phrase
      indistinguishable from the extremely common, benign Swedish idiom
      "Fan, ta dig samman!" ("come on, pull yourself together!"), which
      would have been rejected with `422` on a completely innocent,
      encouraging message. Reproduced directly, then fixed: multi-word
      entries now require genuine whitespace between their own constituent
      words (matching real phrase boundaries) while keeping full
      repeated-letter/inserted-punctuation absorption *within* each word
      unchanged — accepted trade-off, documented in the code: a multi-word
      entry can now be evaded with non-whitespace punctuation between its
      words, which is a more deliberate evasion than this filter is
      designed to catch on a first attempt, and squarely inside ADR-0007's
      already-stated "catches words, not patterns" limitation. Added
      regression test coverage (`keyword-match.util.spec.ts`) for both the
      false positive and the real phrase/evasion cases. Everything else
      checked out clean — no further findings.
- [x] **security-reviewer**: **explicit sign-off — safe to merge.** No
      confirmed vulnerability, IDOR, or child-privacy violation in any of
      the three phases; every claim the ADRs make was independently
      verified against the actual code (message-visibility query,
      reporter anonymity, consent-gate parity with training-logs, the
      `getParentContact` module-boundary widening, captain-transfer
      race-freedom, the leaderboard query's structural inability to
      return player data, per-player not per-IP rate limiting, no
      recurrence of the Phase 2 session-reissue bearer-token pattern).
      Gave a direct opinion on the question ADR-0007 posed rather than
      just restating its hedge: the "keyword filter + anonymous report →
      best-effort rate-limited parent/coach email + silent per-viewer
      block + out-of-band admin hide" posture **is acceptable for the
      current beta specifically because teams are small, closed,
      real-world-known rosters** — explicitly **would not** sign off on
      the same posture at general-availability scale or if teams ever
      include players who don't already know each other in person, and
      treats the deferred LLM-moderation backlog item as a near-term,
      not indefinite, follow-up condition of this sign-off. One
      PLAUSIBLE low-severity finding, fixed: the 24h report-notification
      cooldown was claimed even when no recipient existed (no parent
      contact, no coach on file), silently wasting that player's cooldown
      window on a report that could never have produced an email —
      reordered so the cooldown is only claimed once a real recipient is
      confirmed.

**Fas 2.6a/2.6b/2.7 has cleared every gate and is ready to merge.**
Backend: lint, build, 120/120 unit tests (including new regression
coverage for the code-critic's finding), 55/55 e2e tests, re-run multiple
times against a genuinely fresh Postgres 18 + Redis instance with no
flakiness. Frontend: clean typecheck/expo-doctor plus live exercise
against that same real backend. Both the mandatory code-critic and the
blocking security-reviewer sign-off (per ADR-0007/CLAUDE.md) are complete,
with both reviewers' findings fixed and verified, not just noted. Two
small, non-blocking gaps remain tracked for a future fast-follow, not
blocking this merge: the `GET .../chat/blocks` endpoint ux-designer
flagged (block-management is currently client-cache-backed only), and the
`getActivePotForTeam` between-seasons `500` behavior (an existing,
already-accepted Phase 1 gap, now slightly more visible now that a
leaderboard exists to compare against).

## Phase 2.9 — Self-service team creation

The project owner's instruction: if the invite code a new person enters at
onboarding doesn't match any team, they should be able to create a new team
right there instead of dead-ending — becoming its first player and
**automatically its captain**. Confirmed product decisions: the new team's
name is checked with the same content-safety mechanism built for chat
(`ChatModerationCheck`), since `Team.name` is now cross-team-visible via the
VM-Guld leaderboard; and a newly self-created team gets a working
`Season`/`TeamSeasonPot` atomically, not as a manual follow-up. This is
fundamentally a Phase 1 onboarding contract change (branch
`self-service-team-creation`, stacked on `phase2.6-2.7-architecture` since
it reuses that branch's chat-moderation code), landing after later phases'
work chronologically.

- [x] **architect**: designed team creation inside `OnboardingService
      .createPlayer`'s existing transaction (no separate `POST /teams` —
      avoids an orphaned team if onboarding is abandoned partway through),
      the originally-typed invite code becoming the new team's permanent
      code (evaluated against generating one, rejected as more friction for
      no real benefit), a new minimal `moderation/` module extracting the
      `CHAT_MODERATION_CHECK` DI binding so team-name checks and chat reuse
      one seam without pulling all of `TeamChatModule` into onboarding, a
      Swedish half-year season/pot default consistent with existing seed
      data, and an explicit `409 invite_code_taken_concurrently` for the
      (rare) two-people-race-the-same-code case rather than a silent
      fallback-to-join. → `adr/0009-self-service-team-creation.md`,
      `api/phase1-contract.md`'s 2026-07-09 addendum. **Fully additive**:
      a client that never sends the new optional `teamName` field sees
      byte-for-byte existing Phase 1 behavior.
      **Five adjacent risks flagged, not silently resolved** — the most
      important: a newly self-created captain could exercise full captain
      authority (weekly-goal management, roster/consent visibility,
      triggering a teammate's session-reissue) *before their own parental
      consent is approved*, since no captain-gated endpoint has ever
      checked the *acting* captain's own consent status, only the target's
      where relevant — this was previously unreachable (a seed captain's
      consent is pre-approved; an ADR-0006 transfer target is always
      already-onboarded) but is now the first realistic path where it's
      live. **Decided, not left open**: captain-gated actions now also
      require the acting captain's own `parentalConsentStatus ===
      approved`, extending the same pattern that already gates training-log
      creation and chat sends — closes the window rather than leaving a
      still-pending child with live authority over teammates. Flagged for
      **security-reviewer to confirm this decision**, not just implement it
      blindly. Other flagged items, left for their respective owners:
      team-creation abuse/rate-limit posture (the existing 10/min/IP
      onboarding throttle now bounds a heavier action — security-reviewer),
      permanently-orphaned self-created teams if consent is never approved
      (accepted, consistent with this app's existing no-deletion posture),
      the missing O1 "are you sure?" confirmation before an irreversible
      team creation — unlike joining an existing team, which already has
      one at O2 (ux-designer), and whether the invite code itself (not just
      the name) should also pass the content filter, since it's now
      potentially child-chosen and permanently repeated aloud to recruit
      teammates (recommended by architect, decided here: yes, run the same
      check against both fields).

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
