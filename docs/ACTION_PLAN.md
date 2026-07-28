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
      - [x] **security-reviewer, CONFIRMED CRITICAL — session-reissue allows
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
            possession of the code. **RESOLVED 2026-07-27** — the redesign
            emails the code to the target's own `parent_contact`, never
            returning it to whoever triggers reissue; see
            `docs/adr/0004-coach-auth-and-session-reissue.md`'s
            "Addendum — 2026-07-27" for the full design and its own
            independent security-reviewer pass (which found and fixed a
            second, related gap — a missing daily cap alongside the burst
            cooldown).
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
- [x] **ux-designer**: designed the three gaps ADR-0009 left open. O1's old
      one-line `404` becomes Screen O1a — two big, equal-weight cards
      ("Jag skrev nog fel" vs. "Vårt lag har ingen kod än"), deliberately
      neither styled as primary so the UI doesn't nudge a kid toward
      creating a team. A real confirmation gate (O1b name entry → O1c
      confirm) sits immediately after naming, before O3-O5's personal-info
      screens — mirroring exactly where O2 already sits for the join path,
      so a kid backs out before typing a birth year or parent contact, not
      after. New copy for `422 team_name_rejected_by_filter` (non-
      judgmental, typed text preserved, same posture as chat's filter
      rejection) and `409 invite_code_taken_concurrently`. A distinct
      👑🎉 founding-captain celebration variant of Screen O6, built
      **strictly off the response's `teamCreated`/`isCaptain` fields, not
      which UI path was taken** — a real, correct catch: per ADR-0009
      Decision 8's race handling, a kid who tapped "create" at O1c can
      still legitimately land on the ordinary "joined" variant with zero
      error if someone else's request won the same code first in the
      interim; building O6 off a locally-remembered "I came from create"
      flag instead would show the wrong celebration in that case. →
      `design/phase1-flows.md` (extended in place, continuing its O-prefix
      scheme), `design/phase1-mockup.html`. Also designed (speculatively,
      since the invite-code-filter decision above postdates this pass) the
      recovery copy for an invite-code filter rejection — confirmed
      consistent with the decision now that it's been made.
- [x] **backend-developer**: implemented ADR-0009 end to end —
      `OnboardingService.createPlayer`'s `resolveTeam` helper matches the
      ADR's algorithm exactly (including silently ignoring a redundant
      `teamName` when the invite code already matched a real team);
      `TeamsService.createTeam` checks both `name` and `inviteCode` against
      the content filter before saving; a new minimal `moderation/` module
      extracts the `CHAT_MODERATION_CHECK` binding so team-name checks
      reuse chat's already-shipped filter without pulling in
      `TeamChatModule`'s unrelated entities/imports (verified: no circular
      import, `TeamChatModule` and `TeamsModule` both depend on
      `ModerationModule` independently); the acting-captain consent gate
      decided above is implemented in both `assertIsCaptainOfTeam` (covers
      weekly-goal create/patch/roster, consent-reminder-resend,
      session-reissue-trigger — every caller, confirmed by grep) and
      `transferCaptaincy`'s own inline row-locked check; a new partial
      unique index (`idx_team_season_pot_one_active_per_team`) backstops
      the first real non-seed pot-creation path; the invite-code-race case
      is an explicit `409 invite_code_taken_concurrently`, not a silent
      fallback, covered by a dedicated concurrency e2e test that also
      confirms the loser's transaction fully rolls back (no orphan
      team/season/pot/player). Independently verified (not just the
      implementing agent's report): read the consent-gate, transaction
      algorithm, moderation-check call sites, module wiring, and season-date
      computation directly; lint/build/131 unit tests/71 e2e tests all pass
      against a genuinely fresh Postgres 18 + Redis instance (5 migrations
      applied cleanly, including the new index), re-run 5 times total (one
      transient "connection terminated" flake on the very first run right
      after a fresh container start, not reproduced across 4 subsequent
      clean runs — consistent with this suite's already-documented
      shared-Postgres/parallel-execution characteristics, not a new bug).
- [x] **frontend-developer**: built Screens O1a/O1b/O1c, O5's two new error
      branches, and O6's celebration variant against the live backend.
      Screen O6 confirmed built strictly off the `201` response's
      `teamCreated`/`isCaptain` fields (traced directly: `data.teamCreated`/
      `data.isCaptain` are set from `response.teamCreated`/`response
      .isCaptain` at the point of the API call, never from any locally-
      tracked "which screen did I come from" state) — the correctness
      property the flow doc most cared about. Verified live against a real
      backend: `201` team creation, the `409` race (fired two genuinely
      concurrent requests), and `422` filter rejection (using a real
      wordlist entry) all matched the contract byte-for-byte; `tsc`/
      `expo-doctor` clean; a full Metro bundle compiled with no errors.
      Could not do a literal simulator/Expo-Go tap-through (no
      iOS Simulator/Android emulator in this Linux environment) —
      deliberately avoided driving the desktop's GUI to get a screenshot
      instead, since doing so risked capturing the project owner's other
      open windows; flagged as a real, not-fully-closed verification gap
      rather than glossed over.
      **One real gap found on review, fixed before commit**: the backend's
      `TeamsService.createTeam` checks both the team name and the invite
      code against the content filter but throws the identical
      `422 team_name_rejected_by_filter` for either — the original
      frontend copy ("Lagnamnet gick inte att spara...") only blamed the
      name, which would have misdirected a kid whose *code* was actually
      the problem into repeatedly retyping an already-fine name. Not a
      dead end (the "Byt kod" link was always present on Screen O1b) but
      genuinely misleading — copy corrected to name both possibilities and
      point at "Byt kod" explicitly.
- [x] **code-critic**: reviewed the full backend+mobile diff after
      independently re-running lint/build/unit/e2e (fresh Postgres 18 +
      Redis) and the mobile typecheck/expo-doctor. **One CONFIRMED bug,
      fixed**: `class-validator`'s `@IsNotEmpty()` on `inviteCode`/
      `teamName` (`create-player.dto.ts`) only rejects the exact empty
      string, not a whitespace-only one — a request with
      `inviteCode: "   "` passed validation *and* the content-safety
      filter (a string containing no banned word trivially "passes") and
      got permanently persisted as a blank `Team.name`/`invite_code`, with
      no rename/delete feature to recover it, and no way for the mobile
      client (which trims client-side) to ever reproduce the exact
      untrimmed code again to invite teammates through the app. Reproduced
      live against real Postgres/Redis, then fixed: both fields now go
      through a trimming `@Transform` before `@IsNotEmpty`/the filter check
      — the same convention already used in
      `team-chat/dto/create-chat-message.dto.ts` — so whitespace-only input
      is rejected and legitimate input has its incidental leading/trailing
      whitespace trimmed before it's ever persisted or filter-checked.
      Regression coverage added in a new
      `phase2.9-whitespace-validation.e2e-spec.ts` (not the existing
      `phase2.9-self-service-team-creation.e2e-spec.ts` file, which was
      already sitting at that file's shared-app-instance `POST /players`
      throttle limit — `@Throttle({ limit: 10, ttl: 60_000 })` — so a fresh
      app instance was needed for a fresh throttle bucket). Verified
      independently: lint/build clean, 131/131 unit tests, 74/74 e2e tests
      (71 existing + 3 new) against a genuinely fresh Postgres 18 + Redis
      instance. Everything else checked — transaction atomicity, the
      unique-violation catch scoping, `assertIsCaptainOfTeam` coverage
      across every captain-gated call site, moderation-module DI wiring,
      the half-year season-boundary math, and the mobile confirmation
      screen's `teamCreated`/`isCaptain` derivation — came back clean.
- [x] **security-reviewer**: **safe to merge.** Independently re-verified
      (not taken on trust): re-ran `pnpm run test`/`test:e2e` against a
      genuinely fresh Postgres 18 + Redis instance (131/131 unit, 74/74
      e2e), confirmed the whitespace-trim fix runs before `@IsNotEmpty()`
      by reading `main.ts`'s `ValidationPipe({ transform: true })` config
      (not just trusting the test result), traced every
      `assertIsCaptainOfTeam` call site (weekly-goal create/patch/roster,
      consent-reminder-resend, session-reissue-trigger) plus
      `transferCaptaincy`'s separate inline copy of the same consent gate,
      confirmed `TeamsService.createTeam` is the only code path that ever
      constructs a `Team` row and checks both `name`/`inviteCode` against
      the filter with no bypass, confirmed no IDOR (every endpoint
      re-derives `teamId` from the JWT, `CreatePlayerDto` has no `isCaptain`
      field and `forbidNonWhitelisted: true` blocks injecting one), and
      confirmed no location/PII field was added anywhere in the feature.
      Also confirmed, correcting the ADR's own text: the "no confirmation
      before irreversible team creation" gap ADR-0009 flagged as still open
      was in fact already closed by ux-designer/frontend-developer's Screen
      O1c. **One MEDIUM, non-blocking finding, tracked not fixed now**: the
      `10/min/IP` throttle on `POST /players` uses `ThrottlerModule`'s
      default in-memory storage (not Redis-backed, despite Redis already
      being a dependency) while `k8s/api-deployment.yaml` runs `replicas:
      2` — the counter is per-pod, so a real multi-replica deployment gives
      roughly double the advertised ceiling on an unauthenticated endpoint
      that, after this phase, can create a full permanent
      Team+Season+TeamSeasonPot per call rather than just a junk Player row.
      Pre-existing gap (unchanged throttle shape from Phase 1), not
      introduced by this PR's diff — but this phase is what makes the
      endpoint heavy enough for it to matter. **Required before the k8s
      manifests carry real external-beta traffic** (Redis-backed throttler
      storage, or `replicas: 1` until then) — tracked in Phase 4's
      production-hardening pass, not blocking this merge.

**Fas 2.9 has cleared every gate and is ready to merge.** Backend: lint,
build, 131/131 unit tests, 74/74 e2e tests (71 existing + 3 new regression
tests for the whitespace-only `inviteCode`/`teamName` fix), re-run against a
genuinely fresh Postgres 18 + Redis instance. Both the mandatory code-critic
and blocking security-reviewer sign-off are complete, with the one CONFIRMED
code-critic finding fixed and independently re-verified by security-reviewer,
not just noted. One non-blocking follow-up remains tracked (the in-memory/
multi-replica throttler gap above) for before real external-beta traffic.

## Phase 3 — Media & social ("Fas 3")

This phase is the highest privacy risk (video, a feed, tagging teammates) —
treat `security-reviewer` involvement as blocking, not a final check.

- [x] **architect**: designed video storage on this project's *actual*
      infra (a shared internal PaaS with no confirmed cloud object storage,
      per `k8s/README.md`/`temp/HANDOFF.md`) rather than assuming AWS
      S3/GCS: a self-hosted, S3-API-compatible MinIO pod, deployed with the
      same Deployment+PVC+ClusterIP shape this repo already uses for
      Postgres. Access is scoped structurally, mirroring ADR-0008's
      join-avoidance bar for the leaderboard: the bucket has zero public
      read access, and the backend only ever mints a short-lived presigned
      URL after re-checking `clip.teamId === requestingPlayer.teamId` on
      every single request — never cached, never reused. →
      `adr/0010-video-storage-and-serving.md`, `api/phase3-contract.md`.
      **Decided the tagging/local-ML question explicitly, not left
      hedging**: "tag a teammate to challenge them" is an ordinary FK
      reference (no ML needed); "clip validity" splits into a deterministic
      technical check (file type/size/duration — built now) and content
      classification (does this actually show floorball training — would
      need real ML, **explicitly deferred**, no Python/uv service built
      this phase, mirroring ADR-0007's chat-moderation deferral reasoning;
      tracked in `docs/BACKLOG.md`). **One deliberate divergence from
      ADR-0007's chat precedent, reasoned through rather than copied**: a
      single report **auto-hides** a clip immediately (chat explicitly
      rejected auto-hide-on-report) — justified by video's different harm
      asymmetry (a false-positive hide costs little; a false-negative
      leaves a child's actual likeness visible to the team) and by this
      app having no way to verify a "you filmed me without consent" claim
      before acting on it. Retention: clips are ephemeral by default (a
      recommended, tunable 90-day rolling window, hard-deleted; not tied to
      `Season`'s already-flagged inconsistent boundaries), uploader
      self-delete is immediate and unconditional (this phase's real answer
      to "please take this video down," without needing the full
      account-erasure feature this app still doesn't have — flagged as an
      inherited, now-higher-stakes gap, not solved here), and `ClipReport`
      survives a clip's own deletion via a nullable FK + denormalized
      uploader id, same durability pattern as `ParentalConsentRecord`.
      **Left open, flagged for ux-designer/backend-developer**: whether an
      existing chat block should also suppress a teammate's clips; exact
      numeric caps (retention window, file/duration limits, rate limits)
      are recommended but explicitly tunable, not fixed by this ADR.
- [x] **security-reviewer**: reviewed the architecture (ADR-0010 +
      `phase3-contract.md`) *before* any code exists, per this phase's
      explicit sequencing. **Verdict: safe with required changes — not a
      full sign-off yet.** The structural team-scoping (bucket has zero
      public/anonymous read path; every read re-checks `clip.teamId ===
      requestingPlayer.teamId` and mints a fresh, short-lived presigned URL
      per request, never cached/reused), the consent gate correctly
      extended to reads (not just uploads), the retention/self-delete
      design, and the `ClipReport` denormalization-survives-deletion pattern
      all independently check out — no IDOR path found across the 5
      endpoints, no `real_name`/report-identity leak, no cross-team
      reachability. Two findings, one blocking:
      - [x] **CONFIRMED, BLOCKING — no video metadata (GPS/EXIF-equivalent)
            stripping anywhere in the design.** Decision 3 explicitly rules
            out re-encoding/deep inspection of uploaded video, and neither
            the ADR nor the contract mentions removing embedded location
            metadata before an object is stored or served. Phone-recorded
            video routinely embeds GPS coordinates in the container itself
            (e.g. QuickTime's `com.apple.quicktime.location.ISO6709` atom,
            Android camera apps' `loci`/`xyz` atoms) whenever the recording
            device had location services on — this is the literal "EXIF
            data in uploaded clips" case CLAUDE.md's no-location-tracking
            constraint calls out by name. As designed, a child's clip
            recorded at home would carry their home's GPS coordinates
            straight through to every teammate's presigned playback,
            unnoticed by anything in this pipeline. **Required fix before
            backend-developer builds the `complete` endpoint**: strip all
            container-level metadata (a fast remux, e.g.
            `ffmpeg -map_metadata -1 -c copy`, not a full re-encode — cheap
            enough to run synchronously in the same step as the existing
            `HEAD` check) before setting `status: 'published'`. This should
            be added to ADR-0010 Decision 3 as a third, mandatory check
            alongside the existing technical-validity checks, not left
            implicit.
      - [x] **PLAUSIBLE, required before build — presigned-PUT size isn't
            actually enforced, and `pending_upload` rows/objects have no
            cleanup path.** A raw S3-API presigned PUT (as opposed to a
            presigned POST with policy conditions) generally can't enforce
            a max content-length server-side, so a client can PUT far more
            than the declared `fileSizeBytes` to MinIO; combined with
            `expires_at` only being set at `complete` time, a client that
            calls `upload-url` repeatedly and never (or only sometimes)
            calls `complete` leaves orphaned objects/stale `pending_upload`
            rows that the 90-day retention sweep never reaches (it only
            queries `published` rows with an `expires_at`) — a storage-
            exhaustion path on the single-replica, PVC-backed MinIO pod.
            Needs either a presigned POST with a content-length-range
            condition, or a periodic sweep for stale `pending_upload` rows
            (e.g. older than the presigned-PUT expiry window), or both.
      - Non-blocking, flagged for ux-designer, not gating backend-developer:
        declared `durationSeconds` is never independently verified (the
        `complete` `HEAD` check only compares size/content-type against
        what MinIO reports, not actual media duration) — folding a
        duration check into the same ffmpeg/ffprobe pass used for metadata
        stripping above would close this almost for free. Also: the
        auto-hide-on-report divergence (ADR-0010 Decision 4) is reasoned
        soundly and is judged an acceptable trade at this beta's scale, but
        note it compounds slightly worse than chat's version — a single,
        unverified report both hides the clip *and* triggers a
        parent-facing email framed around "your child was reported"
        before any human review has occurred. Recommend neutral,
        provisional-sounding copy in that email (ux-designer's call), not a
        design change.
      **RESOLVED 2026-07-22** — both items above closed by architect's
      follow-up (commit `f9a27b4`, entry below) and confirmed in
      security-reviewer's focused re-review (entry further below): **full
      sign-off**, superseding the "not yet safe to hand to backend-developer
      as-is" verdict originally recorded here.
- [x] **architect follow-up (2026-07-22)**: closed both required findings
      above, same day, before any implementation started. Decision 3 of
      `adr/0010-video-storage-and-serving.md` now specifies the
      metadata-stripping remux (`ffmpeg -map_metadata -1 -c copy` or
      equivalent) as a **mandatory** third check at the `complete` step —
      publishing without it succeeding first is not an allowed path
      (`422 clip_processing_failed` otherwise); folded in the non-blocking
      duration-verification suggestion as an optional extension of the same
      pass. Decision 5 gained a **required** `pending_upload` TTL (~1 hour)
      with its own, more frequent sweep (reusing the daily retention job's
      mechanism, not new infrastructure) so abandoned/never-completed
      uploads can't accumulate unbounded on the single-replica MinIO pod;
      Decision 1 gained a bucket-level max-object-size configuration note as
      defense in depth against a presigned PUT's inability to enforce
      `Content-Length` server-side. `api/phase3-contract.md`'s endpoint 2
      and implementer notes updated to match (new `422
      clip_processing_failed` error, the second scheduled-sweep note, the
      bucket-size config note); also folded in the non-blocking
      parent-notification-copy note for ux-designer. Both docs carry an
      explicit revision note dating this change. **Re-requesting
      security-reviewer sign-off against the revised version — not
      self-certified as resolved.**
- [x] **security-reviewer re-review (2026-07-22)**: focused re-review of
      architect's follow-up (`f9a27b4`) against the two required findings
      above, not a full re-review from scratch. **Full sign-off — safe for
      ux-designer/backend-developer to build against `adr/0010` +
      `phase3-contract.md` as they now stand.**
      - **Metadata stripping**: confirmed `ffmpeg -map_metadata -1 -c copy`
        is the correct, standard technique for removing exactly the
        container-level location atoms named in the original finding
        (QuickTime's `com.apple.quicktime.location.ISO6709`, Android's
        `loci`/`xyz`) — these are ordinary format-level metadata tags, which
        `-map_metadata -1` strips; a stream-copy remux (no decode/re-encode)
        is the standard, lossless, low-cost way to do this and doesn't
        conflict with Decision 3's separate "no ML/deep content inspection"
        scope, since remuxing container metadata and decoding video frames
        for classification are unrelated operations. Confirmed the ordering
        genuinely prevents an unstripped file from ever becoming reachable:
        `status` only flips to `published` after the remux succeeds, the
        feed query (endpoint 3) only ever returns `published` clips, and
        `complete`'s own response only includes `playbackUrl` on the
        success path (never on the new `422 clip_processing_failed` path)
        — there is no documented code path that mints a playback URL before
        the remux has run, and a failed remux leaves the clip permanently
        `pending_upload` (never silently published unstripped).
        **Minor, non-blocking refinement for backend-developer, not gating
        this sign-off**: the exact command should explicitly `-map` only
        the video/audio streams (e.g. `-map 0:v:0 -map 0:a:0`) rather than
        relying on default stream selection, so an exotic action-camera
        telemetry/GPS data track (e.g. GoPro's GPMF format, a dedicated
        stream rather than container metadata) is guaranteed dropped too,
        not just assumed dropped by default stream-selection behavior —
        edge case beyond this app's realistic ordinary-phone-video threat
        model, doesn't change the verdict.
      - **`pending_upload` exhaustion**: confirmed the ~1 hour TTL + hourly
        sweep bounds standing storage to a rolling window sized by the
        upload-frequency rate limit rather than growing unboundedly over
        time, and the new bucket-level max-object-size config closes the
        gap where a raw presigned PUT can't itself enforce
        `Content-Length`. Together these close both halves of the original
        finding (unenforced size, and no cleanup for abandoned uploads).
        **Minor, non-blocking note**: the ADR doesn't explicitly restate
        the daily sweep's "delete object before row, safer failure
        direction" ordering for the new `pending_upload` sweep (it says the
        mechanism is reused/parameterized, which reasonably implies the
        same ordering, but doesn't say so in as many words) — worth
        code-critic/backend-developer confirming directly during
        implementation rather than assuming, same spirit as the original
        contract's own "confirm directly rather than take this contract's
        word for it" instruction.
      Neither refinement above is required before backend-developer starts;
      both are implementation-detail hardening notes for backend-developer/
      code-critic to keep in mind, not new blocking findings.
- [x] **ux-designer**: designed the feed (new "Klipp" tab, placed third —
      Hem, Chatt, Klipp, Mål, Laget — by realistic visit frequency), the
      two-phase upload flow (pick/record → caption + optional
      tag-a-teammate → progress → published, with every contract error
      case handled including `422 caption_rejected_by_filter`'s
      typed-caption preservation), the report flow (tap-to-reveal, not
      long-press; `appears_without_consent` listed first among the five
      reasons; confirmation copy that states the immediate auto-hide
      plainly without promising a review timeline this app can't
      guarantee), and self-service delete (one confirmation step, using
      this app's reserved destructive/red button, since clip deletion is
      genuinely irreversible unlike K4's captain transfer or CH4's block).
      → `design/phase3-flows.md`, `design/phase3-mockup.html`.
      **Deliberate framing decision, directly against CLAUDE.md's "borrow
      the hook, not the dark pattern" instruction**: the feed is a
      tap-to-play card list with an explicit "Visa fler klipp" button, not
      a TikTok-style autoplay/swipe-to-next/infinite-scroll stack — even
      though the contract's `before` cursor would technically support
      auto-loading. **Resolved the contract's explicitly left-open
      question**: yes, an existing `TeamChatBlock` now also suppresses
      that teammate's clips (filtered on `uploaderPlayerId`, not
      `taggedPlayerId`) — a single per-viewer "block this person"
      preference spanning both surfaces, not two independent settings;
      flagged for architect/backend-developer to add this filtering rule
      explicitly to `phase3-contract.md` endpoint 3, and for
      frontend-developer that CH4's already-shipped block-confirmation
      copy needs a small update to mention clips too. Also designed: a
      client-only "you were challenged" banner reusing the existing
      K5/G3 local-flag-diff mechanism (no new backend, honest about its
      no-push limitation), and neutral/informational parent+coach
      report-notification email copy per security-reviewer's specific ask
      (explicitly pre-empts the "guilt already established" reading a
      single unverified report could otherwise imply).
- [x] **backend-developer**: new `backend/src/video-clips/` module — `VideoClip`/
      `ClipReport` entities + migration (per ADR-0010's exact field lists:
      `tagged_player_id` `ON DELETE SET NULL`, `uploader_player_id` `ON
      DELETE RESTRICT`, `clip_report.clip_id` nullable `ON DELETE SET
      NULL` + denormalized `reported_uploader_player_id`, `team_id`
      denormalized on `VideoClip` at upload time), all 5
      `phase3-contract.md` endpoints, an `ObjectStorageService`
      (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` talking to a
      new MinIO service), a `VideoProcessingService` that shells out to
      `ffmpeg`/`ffprobe` for the mandatory metadata-stripping remux at
      `complete` (explicitly `-map`ping only the first video/audio streams
      per security-reviewer's non-blocking refinement), and a
      `ClipRetentionService` with the two required `@nestjs/schedule`
      sweeps (daily 90-day expiry, hourly `pending_upload` TTL,
      object-then-row deletion order, sharing one mechanism). Added the
      `TeamChatBlock` feed-filter `phase3-contract.md` endpoint 3 was
      missing (per ux-designer's flag) directly to that doc as part of
      this pass. New `k8s/minio-deployment.yaml`/`minio-pvc.yaml`/
      `minio-service.yaml` (identical Deployment+PVC+ClusterIP shape to
      Postgres, ClusterIP-only, never an Ingress/NodePort/LoadBalancer),
      new `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` entries in
      `k8s/secret.yaml.example`, `MINIO_ENDPOINT`/`MINIO_BUCKET`/
      `CLIP_RETENTION_DAYS`/`CLIP_PENDING_UPLOAD_TTL_MINUTES` in
      `k8s/configmap.yaml`, `k8s/README.md`'s file table/deploy-order
      updated, `.github/workflows/ci-cd.yml`'s deploy job and its
      `backend-test` job's service containers updated to match (a
      `bitnami/minio` CI service container, since GitHub Actions service
      containers can't override a command the way `docker-compose.yml`/
      `k8s/`'s official `minio/minio` image needs). `backend/Dockerfile`'s
      runtime image now installs `ffmpeg` (`apk add`); `docker-compose.yml`
      gained a `minio` service matching this shape, wired into the `api`
      service's `depends_on`/env.
      **Verified independently, not just by inspection**: brought up a
      genuinely fresh Postgres 18 + Redis + MinIO via `docker-compose`, ran
      migrations clean, and exercised the real pipeline end-to-end — a
      synthetic clip with injected `location`/`title` container metadata
      was uploaded via a real presigned PUT to a real MinIO instance,
      `complete` ran the actual `ffmpeg` remux, and the bytes served back
      from the fresh presigned GET were confirmed (via `ffprobe`) to have
      that metadata actually stripped — the mandatory no-location-tracking
      fix is real, not asserted. Also verified the `422
      clip_processing_failed` path against a genuinely corrupt upload (clip
      stays `pending_upload`, bad object deleted), the `409
      upload_not_found` path (never PUT anything), and the `TeamChatBlock`
      feed-filter end-to-end (a blocked uploader's clip is absent from the
      blocker's feed, present for everyone else). Lint/build clean;
      171 unit tests (up from 131) and 98 e2e tests (up from 74) pass
      against fresh datastores, re-run 4 times with no flakiness. Includes
      a dedicated concurrency e2e test
      (`phase3-video-clips-report-concurrency.e2e-spec.ts`, mirroring
      `captain-transfer-concurrency.e2e-spec.ts`'s convention) for the
      report path's pre-check/insert/cooldown-claim race — 8 genuinely
      concurrent identical report requests from one reporter always
      produce exactly one persisted `ClipReport` row and exactly one
      `201`, regardless of which request wins.
      **One real, verified finding flagged for security-reviewer/the
      project owner, not glossed over**: the bucket-level max-object-size
      *policy* (ADR-0010 Decision 1's defense-in-depth ask) does not
      currently work against MinIO — confirmed live, independently, both
      via `ObjectStorageService`'s own `PutBucketPolicyCommand` call and
      directly via `mc admin policy create`, that MinIO's policy engine
      rejects the `s3:content-length-range` condition key outright as "an
      invalid condition key," not a silent no-op. The attempt is kept
      (harmless, logged-on-failure, and it's a real, working AWS S3
      mechanism if this project ever moves off self-hosted MinIO per
      ADR-0010's own portability framing) but **the only currently-active
      control against an oversized PUT to a leaked presigned URL is the
      primary one the ADR already names** — the API only ever hands out
      one rate-limited, validated presigned URL per request. See
      `ObjectStorageService.configureMaxObjectSizePolicy`'s own comment for
      the full account; a dedicated unit test
      (`object-storage.service.spec.ts`) locks in that this failure mode
      degrades gracefully (logs, doesn't throw, doesn't block boot) rather
      than regressing silently later.
- [x] **frontend-developer**: built the new "Klipp" tab (fifth, placed
      third — Hem, Chatt, Klipp, Mål, Laget, per the flow doc's realistic-
      visit-frequency ordering) end to end against `docs/design/
      phase3-flows.md` and `docs/api/phase3-contract.md`: Screen V0's
      one-time intro, V1's consent-gated *whole-tab* waiting/paused state
      (not just a disabled upload button — `GET .../clips` itself 403s a
      non-approved player), V2's tap-to-play card feed with three
      physically separate tap zones per card (avatar/name -> the existing
      CH4 block sheet; video -> play/pause only, muted by default; caption/
      timestamp/"⋯" -> reveals report or delete), explicit "Visa fler
      klipp" pagination (no infinite scroll/autoplay, per CLAUDE.md's own
      anti-dark-pattern instruction — deliberately not using the
      `before`-cursor capability for scroll-triggered auto-loading), and
      Screen V3's "you were challenged" banner reusing `Toast` directly
      (see `mobile/README.md`'s "Known duplication" update) rather than a
      new overlay. Screens V4-V7's full two-phase upload flow
      (`clips/upload/`): client-side pre-check against the same
      duration/size/format caps the backend enforces
      (`clipValidation.ts`), `createClipUploadUrl` -> a direct `PUT` of the
      raw bytes to the presigned `uploadUrl` via `expo-file-system`'s
      upload task (real progress events, not a fake animation) ->
      `completeClipUpload` — confirmed the second call is never skipped,
      matching this project's own history of code-critic catching
      "skip step 2" bugs in similar flows. Every contract error case
      handled: `403 consent_required` (whole-tab state, plus the upload
      flow's own stale-state recovery), `422 caption_rejected_by_filter`
      (typed caption preserved, same convention as chat's
      `message_rejected_by_filter`), `400` validation (the pre-check
      catches most; the `taggedPlayerId`-no-longer-a-teammate race gets its
      own inline recovery), `429` on both upload and report, `422
      clip_processing_failed`/`409 upload_not_found` (both trigger the same
      automatic retry-from-scratch with a fresh `clipId`, per the flow
      doc). Report flow (V9/V10, tap-to-reveal not long-press,
      `appears_without_consent` listed first) and self-delete (V11, the
      first real use of a new `DangerButton` component — this app's
      reserved destructive/red treatment, since clip deletion is the first
      genuinely, unconditionally irreversible action built so far).
      `TeamChatBlock`-affects-clips implemented (filters the local feed
      list immediately on block, matching the backend's own query) and
      `BlockSheet`/`BlockedListScreen`'s copy updated to mention clips, per
      the flow doc's flagged "already-shipped copy needs a small update"
      note. **Verified independently, not just by inspection**: `npx tsc
      --noEmit` and `npx expo-doctor` (18/18, after bumping the `expo`
      patch version to close an unrelated pre-existing drift) both clean; a
      full Metro bundle (`npx expo export`) compiled with no errors (718
      modules). Brought up the existing `docker-compose` stack (api/
      postgres/redis/minio, already running/healthy) and exercised every
      new endpoint for real from a container attached to the compose
      network (so presigned MinIO URLs, whose host is `minio` per
      `MINIO_ENDPOINT`, resolve correctly) — a synthetic clip with injected
      `location`/`title` metadata (generated via the api container's own
      `ffmpeg`) went through a real `upload-url` -> `PUT` -> `complete`
      round trip, and the returned `playbackUrl` was independently fetched
      and confirmed reachable; the clip appeared in a teammate's feed with
      the correct tag; a report immediately hid it from *both* the
      reporter and the uploader's own feed (ADR-0010 Decision 4);
      self-delete removed it permanently and a repeat delete 404'd; a
      `TeamChatBlock` hid the blocked uploader's clips from the blocker
      specifically while a third, unrelated teammate still saw them;
      consent-gated reads were confirmed for both a never-approved player
      and a player whose consent was revoked mid-session (both 403
      `consent_required` on the feed `GET` itself); `422
      caption_rejected_by_filter`, `400` (bad `taggedPlayerId`, over-cap
      duration), `409 upload_not_found`, and both `429` codes (upload
      daily-allowance burst, report per-reporter cooldown) all matched the
      contract exactly. Consent approval/revocation was simulated via
      direct SQL against the same Postgres instance (mirroring how
      backend's own e2e suite bypasses the real parent-email round trip)
      rather than sending real email through the project's live SMTP
      relay. **One real, verified finding, flagged for backend-developer/
      code-critic, not silently worked around**: tracing
      `VideoClipsService.reportClip`'s actual check order (clip-must-be-
      published check, then the existing-report check, then the
      per-reporter Redis cooldown claim, then the insert) shows `409
      clip_already_reported_by_you` is effectively unreachable for clips
      specifically, unlike chat — because a report always immediately
      hides the clip (ADR-0010 Decision 4), any *sequential* repeat report
      404s (`clip_not_found`) before ever reaching the "already reported"
      check, and in a genuinely concurrent race the atomic per-reporter
      cooldown claim (not the unique-report constraint) is what decides
      the race, so a loser gets `429`/`404`, not `409`. The mobile client
      still correctly handles the documented `409` code (harmless, correct
      defense for what the contract states), but the contract/ADR may want
      to note this reachability gap explicitly rather than leave `409`
      looking equally reachable to `429`/`404`. **Known, honestly-stated
      verification gap**: no iOS Simulator/Android emulator exists in this
      Linux sandbox, so the camera/picker/playback UI itself was never
      tap-through-tested on a real device — the live-backend exercise above
      substitutes for that, but is not the same thing, matching this
      project's prior phases' same honest gap.
- [x] **code-critic**: final review before merge. Read every substantive
      file directly against `docs/adr/0010-video-storage-and-serving.md`
      (as amended), `docs/api/phase3-contract.md`, and
      `docs/design/phase3-flows.md` rather than trusting prior summaries —
      the full `backend/src/video-clips/` module, the migration, the feed
      query, `mobile/src/clips/` (especially `V6UploadProgress.tsx`'s
      two-phase sequence and `ClipCard.tsx`'s three tap zones) — then
      independently re-ran everything rather than trusting reported
      results: `pnpm lint`/`pnpm build` clean; a genuinely fresh
      Postgres 18 + Redis + MinIO (this sandbox has no system `ffmpeg`, so
      the unit/e2e runs used a throwaway `node:22-alpine` container with
      `ffmpeg` installed, networked to the same `docker-compose` Postgres/
      Redis/MinIO — functionally identical to `ci-cd.yml`'s service
      containers) — 171/171 backend unit tests (174/174 after this pass's
      own additions, see below), 98/98 e2e tests; `npx tsc --noEmit` and
      `npx expo-doctor` (18/18) both clean for `mobile/`; `docker compose
      build api` succeeds with this pass's fix included.
      **One CONFIRMED bug, missed by every prior round (architecture,
      contract, and both security-reviewer passes) — found and fixed, not
      just flagged, per this project's established pattern:**
      - **CONFIRMED — `completeUpload` never actually performed the
        HEAD-based size/content-type spot-check the ADR and contract both
        describe, despite a comment in `CreateUploadUrlDto` explicitly
        claiming it happens "later, at complete."** Traced the code before
        this fix: `completeUpload` called `objectStorageService.
        headObject(clip.storageKey)` and only ever checked it for
        non-`null` (→ `409 upload_not_found`) — `head.sizeBytes` and
        `head.contentType` were fetched and then never read again anywhere
        in the method. Confirmed via `grep` that neither field is
        referenced outside `object-storage.service.ts` itself, and that no
        existing unit/e2e test exercises a HEAD result inconsistent with
        the declared upload. **Concrete failure scenario**: a player calls
        `upload-url` declaring a small `fileSizeBytes` (passing
        `CreateUploadUrlDto`'s `@Max(25_000_000)` check trivially), then
        `PUT`s an arbitrarily large object straight to the presigned URL.
        Verified live against a real MinIO instance that nothing stops
        this: the presigned URL's `X-Amz-SignedHeaders` is `host` only —
        neither `Content-Length` nor `Content-Type` is part of the SigV4
        signature, so the client isn't bound to its own declared values at
        all — and the bucket-level max-object-size policy is separately,
        independently confirmed non-functional against MinIO (backend-
        developer's already-documented finding, re-confirmed here). With
        the spot-check missing, `completeUpload` would proceed straight to
        `getObjectBuffer`, buffering the **entire** object into memory on
        the single-replica API pod before ever rejecting it — a real
        memory-exhaustion risk on top of the already-known storage-
        exhaustion one, bounded only by the daily 10-uploads-per-day rate
        limit, not by size in any way. **Fixed in
        `VideoClipsService.completeUpload`** (`backend/src/video-clips/
        video-clips.service.ts`): immediately after `headObject` confirms
        the object exists, and *before* `getObjectBuffer` is ever called,
        reject (delete the object, throw the existing `422
        clip_processing_failed`, leave the row `pending_upload`) if
        `head.sizeBytes` exceeds `CLIP_MAX_FILE_SIZE_BYTES` or
        `head.contentType` is a non-null mismatch against the clip's
        declared `mimeType`. Deliberately reuses the existing `422
        clip_processing_failed` code/cleanup path rather than inventing a
        new one — the mobile client's existing "retry from a fresh
        upload" handling for that code already covers this case correctly
        with no client-side change needed. Added three unit tests
        (`video-clips.service.spec.ts`): an oversized HEAD result is
        rejected *and* `getObjectBuffer` is confirmed never called (closing
        the memory-exhaustion path, not just the storage one); a
        content-type mismatch is rejected; a `null` HEAD content-type
        (no assertion possible) is correctly let through rather than
        treated as a mismatch. All pre-existing tests plus these three
        pass (174/174 unit).
      **Both items already flagged on record, verified directly rather
      than taken on faith — reasoning holds for both:**
      - The MinIO `s3:content-length-range` bucket-policy no-op:
        re-confirmed live (the exact "invalid condition key
        's3:content-length-range'" warning appears in the unit-test log
        output) that `ObjectStorageService.configureMaxObjectSizePolicy`
        degrades gracefully — logs, doesn't throw, module boot proceeds,
        the bucket still gets created and used. **With this pass's fix
        above, the "only currently-active control" framing in that
        finding is now stronger than when it was written**: there are now
        two independent, functioning controls (the rate-limited presigned-
        URL flow, *and* the HEAD-based spot-check at `complete`), not one.
      - `409 clip_already_reported_by_you` being unreachable for a
        *sequential* repeat report: confirmed by tracing `reportClip`'s
        exact order — the clip lookup requires `status: 'published'`,
        which the first successful report flips to `hidden` immediately,
        so a second sequential attempt (by anyone, not just the same
        reporter) 404s before ever reaching the already-reported check;
        separately, `tryClaimClipReportCooldown` is a single **per-
        reporter** lock (not per-`(reporter, clip)`), so even a genuinely
        concurrent double-report race from the same reporter resolves via
        `429`, not `409`. The unique-constraint catch is real defense in
        depth for a case this contract doesn't otherwise reach (an
        out-of-band admin un-hide followed by a fresh report, already
        covered by the security-reviewer entry's e2e trace above) — kept
        as-is, harmless, no client behavior depends on it being reachable
        via the sequential path. No change needed.
      **Other things specifically checked, no issues found:** the feed
      query (`listClips`) combines `team_id` scoping, the
      `status = 'published'` filter, and the `TeamChatBlock` `NOT EXISTS`
      subquery in one `createQueryBuilder` chain, not layered
      post-processing, confirmed by reading the query directly. Both
      retention sweeps (`ClipRetentionService`) delete the MinIO object
      before the Postgres row, leaving the row for the next run on a
      transient object-delete failure. `V6UploadProgress.tsx` never skips
      `complete` after a successful `PUT`, caps automatic retries at 2
      attempts rather than looping forever, and its "Avbryt" handler
      correctly calls `DELETE` on a still-`pending_upload` clip (the
      judgment call the flow doc flagged for backend-developer to
      confirm). `ClipCard.tsx`'s three tap zones are genuinely, physically
      separate `Pressable`s, matching the flow doc's rule. Migration FK
      actions (`RESTRICT`/`SET NULL`/`CASCADE`) match ADR-0010's exact
      per-column reasoning.
      **One environmental observation, not a product finding**: one out of
      five independent e2e runs against a freshly-recreated
      Postgres/Redis/MinIO produced 15 spurious failures (duplicate-key
      console errors cascading) that did not reproduce on an immediate
      re-run against an equally fresh database, and 4 subsequent clean
      runs (98/98) followed — traced to this review's own ad hoc
      Docker-network setup churn (a `docker network connect` race while
      standing up the throwaway test container), not a change in
      application code. Noted for the record rather than silently
      dropped, not treated as a gating finding.
- [x] **security-reviewer**: independent implementation-verification pass
      (not a re-review of the architecture — that was already signed off
      pre-build; this is "does the code actually do what the ADR/contract
      promised"). Read every file directly (`video-clips.service.ts`,
      `video-processing.service.ts`, `object-storage.service.ts`,
      `clip-retention.service.ts`, the controller, both entities, the
      migration, the module, the mail template, the k8s manifests, and the
      mobile upload/feed/report/delete screens) rather than trusting prior
      agents' summaries, then went further and **independently executed the
      real thing**: brought up a genuinely fresh Postgres 18 + Redis + MinIO
      via `docker-compose`, ran the migration clean, ran all 171 backend
      unit tests (including `video-processing.service.spec.ts` against a
      real `ffmpeg`/`ffprobe` installed for this pass — not skipped), and
      ran both Phase 3 e2e suites (24 tests) against the live stack —
      everything passed, matching the counts backend-developer/
      frontend-developer already reported. **Verdict: full sign-off — safe
      to merge**, no CONFIRMED blocking findings. Specifics:
      - **GPS/location-metadata stripping (the highest-stakes item)**:
        confirmed `VideoProcessingService.remuxStripMetadata` genuinely
        shells out to `ffmpeg -map_metadata -1 -c copy` (explicitly
        `-map`ping only `0:v:0`/`0:a:0`, the security-reviewer refinement
        from the ADR round), and traced `completeUpload`'s exact ordering:
        `HEAD` check → download → probe → remux (throws
        `ClipProcessingFailedException`/`422` on any failure, object
        deleted, row stays `pending_upload`) → **only then** does
        `putObjectBuffer` overwrite the same `storage_key` with the
        stripped bytes and `status` flip to `published` with `expiresAt`
        set. There is no code path that mints a `playbackUrl` or returns
        one before the remux has succeeded — `completeUpload`'s success
        return (with `playbackUrl`) is reached only after the `status`
        update. Independently re-ran `video-processing.service.spec.ts`
        against a real `ffmpeg`/`ffprobe` (not present on this sandbox by
        default — installed for this pass) and confirmed it does exactly
        what it claims: a synthetic clip embedding
        `com.apple.quicktime.location.ISO6709`/`location`/`title`
        container tags has all of them verified present beforehand, then
        verified **actually gone** after `remuxStripMetadata` runs, with
        the output still a valid, playable stream. Additionally ran the
        real e2e round trip (`phase3-video-clips.e2e-spec.ts`'s "the real
        pipeline" test) against genuinely fresh MinIO: `PUT` real bytes
        with injected location/title metadata → `complete` → fetched the
        served bytes back via the fresh presigned GET → confirmed via
        `ffprobe` the metadata is gone from what's actually served. This is
        the concrete closure of CLAUDE.md's no-location-tracking
        constraint for this feature, verified by execution, not by reading
        the diff.
      - **Structural team-scoping**: confirmed all 5 endpoints re-derive
        `clip.teamId === requestingPlayer.teamId` before any read/write —
        `createUploadUrl`/`completeUpload`/`deleteClip`/`reportClip` via
        `PlayersService.assertTeamMembership(requesterId, teamId)` (throws
        `team_mismatch`) plus, for the four that touch an existing clip
        row, a repository query scoped by `{ id: clipId, teamId }` (never a
        bare `findOne({ id })`) — a cross-team `clipId` structurally 404s
        rather than needing a second, separate check. Confirmed the feed
        query (`listClips`) combines the `team_id` scope, the
        `status = 'published'` filter, and the `TeamChatBlock`
        `NOT EXISTS` subquery **in one `createQueryBuilder` chain**, not as
        client-side or service-side post-processing — mirrors the bar
        already held for the chat message-visibility query.
      - **Consent gating extended to reads**: confirmed `listClips` calls
        `assertConsentApproved` (throwing `ConsentRequiredException`/`403
        consent_required`) immediately after the team-membership check,
        before the query runs — not a client-side-only gate. Confirmed via
        a real e2e request (a `PENDING`-consent player's `GET .../clips`
        returns `403 consent_required`, not an empty/filtered list) and via
        the mobile `ClipsScreen`, which locks the *entire* tab (not just
        the upload button) on `consentStatus !== 'approved'`, with the
        server's own `403` as the authoritative source of truth if that
        client-side state is stale.
      - **Presigned URL handling**: confirmed both presigned PUT and GET
        are minted fresh per call (`ObjectStorageService.
        createPresignedPutUrl`/`createPresignedGetUrl`, no caching layer
        anywhere) and that `storage_key` is server-generated
        (`clips/{teamId}/{clipId}.{ext}`) at `createUploadUrl` and never
        appears in any DTO, request body, or response shape across all 5
        endpoints — grepped every DTO/response interface to confirm.
      - **Report/auto-hide path**: confirmed `reportClip` sets
        `status = 'hidden'` unconditionally right after the `ClipReport`
        insert (not gated on the notification email succeeding), that
        `ClipReport.reportedUploaderPlayerId` is denormalized at write time
        and `clip_id` is nullable/`ON DELETE SET NULL` in the migration
        (survives the clip's own deletion — confirmed live in the e2e
        suite: deleting a reported clip leaves the report row with
        `clip_id: null`), and that no endpoint/response anywhere returns a
        `ClipReport` row, a reporter identity, or a report count — only the
        per-viewer `reportedByMe: boolean` is ever derived from that table.
      - **Retention/deletion**: confirmed both the daily 90-day sweep and
        the hourly `pending_upload` TTL sweep delete the MinIO object
        before the Postgres row (`ClipRetentionService.sweepRows`), leaving
        the row for the next run if object deletion fails transiently — the
        safer failure direction the ADR specifies. Confirmed
        `k8s/api-deployment.yaml` still runs `replicas: 1` (the sweep's
        documented single-replica assumption still holds).
      - **No `real_name`/location exposure**: grepped every new entity, DTO,
        and response interface in `video-clips/` — none reference
        `realName` or any location/geo field; `PlayerPrivateInfoService.
        getParentContact` (this module's documented third caller) only
        returns `parent_contact`, confirmed by reading its implementation
        directly, not assumed from the ADR's module-boundary note.
      - **Mobile client**: confirmed `V6UploadProgress` always calls
        `completeClipUpload` after a successful `PUT` — there is no code
        path that treats the `PUT` alone as success — and that the report/
        delete/consent-gate copy (`ClipReportConfirmationSheet`, the
        parent/coach notification email templates) is honest about not
        guaranteeing a review timeline ("vi kan inte lova exakt när
        klippet granskas igen") and doesn't read as an accusation already
        proven true, matching security-reviewer's specific ask from the
        contract round.
      **Two already-documented non-blocking items re-confirmed, not
      re-litigated** (both correctly labeled by backend-developer/
      frontend-developer, not glossed over): the MinIO
      `s3:content-length-range` bucket-policy no-op (verified again here —
      `ObjectStorageService.configureMaxObjectSizePolicy` logs and degrades
      gracefully, doesn't block boot, and the primary control — one
      rate-limited, validated presigned URL per request — is real and
      independent of this gap); and `409 clip_already_reported_by_you`
      being unreachable for a *sequential* repeat report (confirmed via the
      e2e suite: an immediate second report attempt gets `404
      clip_not_found`, since the first report already flipped the clip out
      of `published`) while still being reachable, and correctly tested,
      for the out-of-band-un-hidden-then-reported-again case. Neither
      changes the verdict.
      **No new findings requiring a code fix this pass** — everything
      checked matched the ADR/contract's promises exactly, which is why
      this is a full sign-off rather than "safe with required changes."

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

## Phase 4.1 — Profile page — done 2026-07-28

**Added 2026-07-28, from the project owner directly; designed and shipped
the same day.** See `docs/adr/0012-profile-page-and-contact-email-change.md`
(incl. its 2026-07-28 addendum) for the full design and its rationale —
summary here for the checklist.

A profile page reachable via the top-right avatar circle: optionally set
a real name (`PATCH /players/me/profile`), view (not edit — see below)
birth year, and change the contact email (`parent_contact` — the
player's own for the 13+ self-verification cohort, the parent's
otherwise).

**Went through the same architect/security-reviewer-blocking sequencing
as `docs/adr/0004-coach-auth-and-session-reissue.md`'s 2026-07-27
redesign** — `parent_contact` is this app's account-recovery trust root,
so a feature letting a user change it is the same risk class, not
routine CRUD:

- **Confirm via the NEW address, notify the OLD one at request time** —
  a single-use code (reusing the session-reissue code generator) is
  emailed to the candidate new address; the current address gets an
  informational notice, no code, at the same time.
- **An independent security-reviewer pass found a real gap** in the
  first cut: no password + a long-lived session token meant a
  momentarily-compromised session could complete both request and
  confirm before the old-address notice could prompt a human to react.
  Fixed by adding a **24h grace period** after confirm (the change
  doesn't apply instantly) plus a **cancel link mailed to the OLD
  address** at confirm time — a web page (not an app screen, since the
  old address may not have the app open), which reverts the change and
  invalidates every session on the account if used. Applies lazily on
  the next profile read once the grace period elapses, no new cron job.
- **Birth year stays read-only** — it drives `isSelfVerificationAge`, so
  a free edit is a potential parental-consent bypass, not just a typo
  fix. A correction path (coach/admin) is explicitly not built yet.
- **No new password/login system** — reuses the existing "email as
  recovery credential" model rather than inventing one, per ADR-0004's
  explicit decision against passwords for this userbase.
- Real name (lower risk, already optional/isolated in
  `PlayerPrivateInfo`) is a direct `PATCH`, no confirmation flow.

Live-verified end-to-end against the real cluster: request → confirm →
grace period holds (contact unchanged) → cancel-link preview/POST →
change reverted + session invalidated; and separately, confirm → grace
period → lazy apply on the next read once elapsed. Mobile UI verified via
a real browser session against the live backend, including the
grace-period toast copy.

## Phase 6 — Public Shorts feed, reactions & personal archive

**Added 2026-07-27, from the project owner directly** (not yet designed —
tracked here so it can be reviewed before any code, per this doc's own
standing practice below). Numbered 6, not 5: `docs/PROJECT.md` already
reserves "Fas 5" for post-launch growth/business ideas (usage analytics,
a paid PT-role plan, LLM chat moderation) — this is new, separate scope,
placed after it in sequence for now, but the project owner should confirm
that ordering rather than have it picked silently. Requested shape,
paraphrased: Shorts becomes a
never-ending scrollable feed of clips other players have opted to make
public, with reactions; a way to save/collect clips you like into your own
archive for mission ideas or new-streak inspiration; and a new "Archive"
tab in Shorts showing (a) your team's clips and (b) clips you personally
own, from which you can choose to publish one to the public feed to get
reactions. Reference points named: Snapchat, YouTube, TikTok, Instagram —
for the endless-scroll mechanic and how each surfaces reactions, not for
their privacy models.

**This is flagged, not silently scoped down, per CLAUDE.md's explicit
instruction to push back on anything weakening the closed-team-bubble
constraint.** Every clip in the app is currently **structurally**
team-scoped only — no cross-team read path exists anywhere in the
architecture. `adr/0010-video-storage-and-serving.md` (Fas 3) states this
as a hard guarantee, security-reviewer independently verified it (**zero**
public/anonymous read access on the storage bucket; every single clip read
re-checks `clip.teamId === requestingPlayer.teamId` and mints a fresh,
never-cached presigned URL), and it's the direct implementation of
CLAUDE.md's "a user only ever sees their own verified team" non-negotiable.
A "public" feed is by definition a second, cross-team visibility path for
video of children — the single highest-risk kind of change this codebase
can make, higher-risk than Fas 3 itself, which is already this project's
"highest privacy risk" phase per its own checklist header above. It is not
a reason to refuse the feature — opt-in publishing is a legitimate product
idea and the request already includes an explicit approval step, which is
the right instinct — but it must go through the same architect →
ux-designer → security-reviewer sequencing Fas 3 used, with security-reviewer
**blocking**, before any schema or endpoint exists. Do not build this by
quietly loosening the existing `clip.teamId` check.

Open questions for that design pass (not decided here):
- What "approve to be public" actually means for a child's account —
  whose approval: the player's, or does publishing a minor's video to a
  wider audience need the same parental-consent gate media upload already
  requires? (CLAUDE.md: "Parental approval flow required before any
  account can upload video/media" — publishing to a *wider* audience than
  what consent was originally given for is a real open question, not an
  extension of the existing upload consent by default.)
  **Candidate answer proposed 2026-07-27 (project owner, not yet decided)**:
  require a real, verified email per child ("child email"), doing double
  duty as a future login-recovery credential (see Fas 4 point 2, "new
  device login/session reissue" — the same missing piece that item needs)
  as well as one or two separate parent emails; publishing a specific clip
  outside the team bubble would require a parent to click a review link
  (they actually see the clip before approving, unlike the existing
  consent flow which approves the *account*, not a specific piece of
  content) and approve *that clip specifically*. This is a materially
  stronger, per-clip gate than the account-level parental consent Fas 1
  already has — architect should evaluate it as the leading candidate for
  this open question, including whether it replaces or layers on top of
  the existing `parentalConsentStatus` gate, and how it interacts with the
  13+ self-verification cohort (docs/adr/0002-data-model.md's 2026-07-27
  addendum) who currently have no parent on file at all by design.
- Is "public" app-wide (any SkillStreak user, any team) or scoped to some
  narrower circle? App-wide is the biggest deviation from the current
  model and the one Snapchat/TikTok/Instagram/YouTube all assume by
  default — worth deciding deliberately rather than by analogy.
- Anonymization: screen names are already usable in place of real names
  per CLAUDE.md, but does a public post need *additional* stripping (e.g.
  team name, which is currently cross-team-visible on the leaderboard per
  ADR-0008, becoming a de-anonymizing link between a public clip and a
  specific real-world team of children)?
- Reactions/comments on a public clip are a new user-generated-content
  surface between strangers, not just teammates — needs the same
  moderation-check treatment ADR-0007/ADR-0009 gave chat and team names,
  not assumed safe by omission.
- Retention/takedown: Fas 3's 90-day rolling retention + immediate
  uploader self-delete was designed for a team-only audience; a public,
  reaction-bearing clip likely needs its own review (e.g. does un-publishing
  also need to be immediate and unconditional, same as delete already is).
- "Archive" as described is two distinct collections (their own reusable
  data model, not a special case of `VideoClip`): *saved-for-inspiration*
  (other people's public clips a player bookmarked) vs. *owned* (a
  player's/team's own clips, published or not) — ux-designer's call on
  whether one tab or two communicates that distinction, per the request's
  own "team's video" vs "videos you are owner of" split.
- **Follow-up, 2026-07-27**: this feed is also the delivery mechanism for a
  separate, since-added backlog item — rewarding video-verified and
  shared/public training with more points than a plain self-reported log,
  plus a PT-content/growth-loop angle. See `docs/BACKLOG.md`'s "Points
  system needs a verification/inspiration tier" entry — a distinct
  architect-level change to the points formula (ADR-0005), not decided or
  scoped here, but load-bearing on why this feed matters beyond inspiration
  alone.

- [ ] **architect**: design the public-opt-in data model (a `visibility`
      or `publishedAt` concept on `VideoClip`, or a separate join/publish
      table — TBD), the archive/save data model, and the reaction data
      model, resolving the open questions above. New ADR, not a Fas 3
      addendum — this is new scope beyond what ADR-0010 signed off on.
- [ ] **ux-designer**: design the endless-scroll feed, reaction UX, and
      the Archive tab (team clips + owned clips + publish action),
      informed by but not copying Snapchat/TikTok/Instagram/YouTube's
      patterns — this app's youth-safety constraints are stricter than any
      of those four.
- [ ] **security-reviewer**: blocking review of the architect's design
      before backend-developer starts, per this doc's standing practice —
      treat with at least the rigor Fas 3's original review used (that one
      found and required fixing a real GPS-metadata leak before shipping).
- [ ] **backend-developer**: implement once the above is signed off.
- [ ] **frontend-developer**: implement once the above is signed off.

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
