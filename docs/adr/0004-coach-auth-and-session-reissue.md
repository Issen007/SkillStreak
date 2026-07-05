# 0004 - Coach authentication and player session reissue

## Status

Accepted — 2026-07-05.

**Parts 1 and 2 superseded — 2026-07-05.** The project owner pivoted Phase 2
away from a separate adult "Coach" concept entirely (a player-captain,
"Kapten," replaces it — see
[`docs/adr/0005-kapten-and-weekly-team-goal.md`](0005-kapten-and-weekly-team-goal.md)).
There is no coach login, no `COACH_JWT_SECRET`, no bcrypt dependency, and no
`coach-auth` module. Parts 1 and 2 below are kept verbatim for the historical
record of why password-based coach login and a separate coach/player token
universe were the original answer — **none of it is being built.** See the
"Addendum — 2026-07-05" section at the end of this document for the full
explanation. **Part 3 (player `token_version` + session-reissue code) is
unrelated to this pivot and stands unchanged** — nothing below in Part 3 is
superseded; only *who is authorized to trigger* the reissue endpoint changes
(a captain, not a coach), which is a contract-level change tracked in
`docs/api/phase2-contract.md` and ADR-0005, not a change to this ADR's Part 3
design itself.

## Context

`docs/design/phase2-flows.md` designs the Phase 2 coach dashboard and
challenge builder assuming a coach-authenticated session already exists, and
explicitly declines to design two things that aren't UI layout questions:

1. **How a coach logs in at all.** `Coach` (`backend/src/coaches/entities/coach.entity.ts`)
   currently has only `email`/`displayName` — no credential, no session
   mechanism. Players use a no-password, coach-facilitated onboarding (a
   bearer JWT issued once at account creation, no login step) — that
   pattern doesn't fit a coach, who logs in repeatedly, across seasons,
   plausibly from more than one device (their phone at practice, a laptop
   at home planning challenges).
2. **How a player's session gets reissued.** Carried over from the Phase 1
   security review (`docs/ACTION_PLAN.md`): the player JWT has a 180-day
   lifetime and no revocation path. Screen C2 in `phase2-flows.md` designs
   a coach-facing "Skicka ny inloggningslänk" trigger and its confirmation
   copy, but leaves the actual mechanism — schema, verification, and how a
   new session reaches a kid's device without a password — to this ADR.

Both are genuine auth-architecture decisions with security weight (children's
accounts, a volunteer non-technical coach userbase, an existing proven mail
pipeline), so they get an ADR rather than being inferred from a UI spec.

## Decision — Part 1: Coach authentication — SUPERSEDED, see Addendum below

> **This entire section describes a design that is not being built.** The
> project owner pivoted to a player-captain ("Kapten") model that reuses the
> existing player JWT — there is no coach login of any kind in Phase 2. Kept
> for the historical record only; do not implement anything in this section.

**Password-based login, with the existing consent-mail infrastructure reused
for password reset only — not for routine login.**

### Why not magic-link-only login

Magic-link login (re-purposing `backend/src/mail/`, the same pipeline
proven for parental consent) was the obvious first idea, given it already
exists and is proven. Rejected as the *primary* login mechanism because:

- It makes every single coach login depend on live SMTP relay + the coach's
  email being reachable *at that moment*. A coach's routine use case is
  "open the app 5 minutes before practice starts, in a gym with patchy
  signal, to send a challenge or check who hasn't logged" — a dependency on
  an email round-trip for something that happens dozens of times over a
  season, not once, is a worse fit than it was for consent (a single,
  infrequent, already-tolerant-of-delay action).
- This is explicitly a volunteer, not-technically-sophisticated userbase
  per CLAUDE.md's project framing. "Check your email, tap the link, get
  bounced back into the app" is a real UX tax paid on every login; typing
  a password (autofilled by the phone's password manager after the first
  time, which is the realistic steady state on a personal phone) is less
  friction for a *repeat* action, even though it's more friction the very
  first time.
- A coach who can't get in mid-practice because their email is temporarily
  unreachable (dead zone, provider hiccup) is a worse failure mode than a
  forgotten password, which a boring reset-link flow already solves.

### Why password, with mail as the recovery path

- Password login has no runtime dependency on SMTP for the common case —
  only for the rare "I forgot my password" case, where a coach already
  expects an email round-trip and isn't standing at the bench waiting on
  it.
- It reuses the mail infrastructure exactly where reuse is a genuine win
  (a proven, working pipeline) without extending it to a role it wasn't
  built for.
- It's the boring, standard option: hashed password (bcrypt — add as a new
  `backend/` dependency; nothing in the current stack provides it), a
  login endpoint, a JWT issued on success. Nothing novel to get wrong.

### Schema changes — `Coach`

```
Coach
  id                          (unchanged)
  email                       (unchanged, unique, login identifier)
  display_name                (unchanged)
  password_hash               varchar, not null                    -- NEW
  password_reset_token        varchar, nullable, unique             -- NEW
  password_reset_token_expires_at  timestamptz, nullable            -- NEW
  created_at                  (unchanged)
```

`password_reset_token`/`_expires_at` mirror the existing
`Player.consent_token`/`consent_token_expires_at` shape (a single-use,
time-boxed bearer secret, nulled on redemption) — same pattern, new purpose,
not a shared column. Same rule applies as the comment already on
`Player.consent_token`: never add either to a response DTO.

**Coach account creation is out of scope here**, same as Phase 1 treated
team/invite-code creation as a seed/admin step (`docs/ACTION_PLAN.md`'s
Phase 1 follow-ups flag this as a standing gap, not new). For Phase 2,
assume a `Coach` row (with a password already set, e.g. via a
backend-developer seed/admin script analogous to the team seed) exists
before login is exercised. A self-serve coach signup/invite flow is a
reasonable Phase 2-or-later follow-up, not designed here — flagging it
explicitly rather than silently deferring it.

### Flow

1. **Login:** `POST /api/v1/coach/auth/login { email, password }` → verifies
   the bcrypt hash, issues a coach-scoped JWT (see Part 3 for how this
   differs from a player token). No account-enumeration tell: wrong email
   and wrong password return the identical `401 invalid_credentials`.
2. **Forgot password:** `POST /api/v1/coach/auth/password-reset/request
   { email }` → always `200`, regardless of whether the email matches a
   coach, to avoid confirming which emails have accounts. If it matches,
   generates a token the same way `generateConsentToken` does
   (`backend/src/players/consent-token.util.ts`'s pattern, a sibling
   utility rather than a literal reuse — different table, different
   purpose), stores it on `Coach`, and emails a reset link via the existing
   `MailService`.
3. **Reset confirm:** `POST /api/v1/coach/auth/password-reset/confirm
   { token, newPassword }` → validates token + expiry, sets a new
   `password_hash`, nulls the token. Does **not** need to touch
   `token_version`-style invalidation (Part 3) — that's a player-specific
   mechanism for a JWT with no login step; a coach who resets a password
   simply logs in again normally on each device.

## Decision — Part 2: coach/player token separation — SUPERSEDED, see Addendum below

> **Also not being built**, for the same reason as Part 1: there is no
> second token universe. Kept for the historical record only.

**Genuinely separate guards and token services, sharing only the underlying
`@nestjs/jwt` library — not the same `JwtAuthGuard`/`PlayerTokenService`,
and not a shared secret.**

Concretely:

- New module `backend/src/coach-auth/` (sibling to `auth/`, same reasoning
  as why `player-private-info/` is its own module rather than folded into
  `players/`): owns `CoachTokenService`, `CoachAuthGuard`,
  `CurrentCoachId` decorator, and the login/reset controller from Part 1.
- `AuthModule`/`JwtAuthGuard`/`PlayerTokenService`/`CurrentPlayerId` are
  **unchanged in shape** (Part 3 adds a claim to the payload and a check to
  the guard, but it's still one class, one purpose: player sessions).
- **Separate secrets**, not a shared one with a discriminator claim: new
  env var `COACH_JWT_SECRET`, alongside the existing `JWT_SECRET` (which
  stays player-only, unchanged — no migration impact on Phase 1's already-
  issued 180-day player tokens). A coach JWT that somehow ended up on a
  player-guarded route (or vice versa) fails signature verification
  outright, before any claim is even inspected — a stronger boundary than
  an `aud`/`typ` claim check that a future contributor could forget to
  add to a new guard, and it costs nothing extra (two env vars instead of
  one).
- Both services can reuse the same `@nestjs/jwt` `JwtService` instance
  (already exported by `AuthModule`) by passing `secret`/`expiresIn` as
  per-call overrides to `sign()`/`verifyAsync()`, rather than standing up a
  second `JwtModule.registerAsync()` registration — simpler DI, no new
  provider tokens, and `@nestjs/jwt` supports this directly.
- Coach JWT lifetime: shorter than a player's 180 days, since a coach *can*
  log in again trivially (unlike a player) — recommend 30 days, refreshed
  implicitly by re-login before then; no refresh-token dance needed at this
  scale.
- Coach JWT payload: `{ sub: coachId }` — no embedded team list. Team
  access is re-derived from `TeamCoach` on every request (see the contract
  doc's `CoachTeamAccessGuard`), not baked into the token, so revoking a
  coach's access to one team (a plausible future need — an assistant coach
  leaving) never requires reissuing a token, just deleting a `TeamCoach`
  row.
- Why not one shared guard with a `role` claim: `JwtAuthGuard` currently
  populates `request.playerId` and every player-side decorator/service is
  built against that shape; overloading it to also branch on coach/player
  would touch every existing call site for no benefit, since coach and
  player routes are already structurally disjoint (`/api/v1/coach/*` vs.
  the existing player routes) — two small, single-purpose guards is the
  boring option here, not the "impressive" unified one.

## Decision — Part 3: player session reissue

**A `token_version` column on `Player`, checked at JWT-verify time, plus a
new coach-triggered short-lived one-time *code* (not a mailed link) that a
kid types into a new "lost your session?" screen — deliberately not the
consent-token mechanism reused verbatim.**

### Schema change — `Player`

```
Player
  ...(unchanged)
  token_version                   integer, not null, default 0     -- NEW
  session_reissue_code             varchar, nullable, unique         -- NEW
  session_reissue_code_expires_at  timestamptz, nullable             -- NEW
```

- `token_version`: bumped by exactly one action — a coach's session-reissue
  trigger (below). Nothing else increments it in Phase 2; a future
  "player self-service logout everywhere" feature could reuse the same
  column without a schema change.
- `session_reissue_code`/`_expires_at`: single-use, short-TTL, nulled on
  redemption — structurally the same *pattern* as `consent_token`, but a
  deliberately different shape (see below for why) and a different table
  purpose, not literal reuse.

### Why a code, not a mailed link, and why it differs from the consent token

The consent-token mechanism (`consent-token.util.ts`) is a 256-bit value
mailed to a **parent's** inbox, opened as a link on their own device,
7-day TTL — right for its purpose (an out-of-band, asynchronous approval a
parent gets to on their own time). Session reissue has a different shape
of problem:

- The recipient is the **kid**, in front of the **coach**, at practice,
  *right now* — not an absent parent checking email later. There's no
  reliable email address for the kid to mail a link to in the first place
  (`parent_contact` belongs to the parent, and routing a *session*
  credential through the parent's inbox for the kid to then relay back is
  slower and stranger than just showing it directly).
- Precedent already exists in this exact codebase for "coach shows a short
  code, kid types it into the app": the team `invite_code` at onboarding.
  Session reissue reuses that *interaction pattern* (short, human-typable,
  read-aloud-or-glanced-at code) rather than the consent link's pattern
  (long, emailed, tapped).
- A short TTL (15 minutes, vs. consent's 7 days) matches the real usage
  window — this is meant to be resolved in the same practice session, not
  held onto.

Format: an 8-character code from a 32-character alphabet that excludes
visually-ambiguous characters (no `0`/`O`, `1`/`I`/`l`, etc.) — human-
typable, ~40 bits of entropy, combined with single-use + 15-minute TTL +
endpoint throttling (mirroring the existing `@Throttle` pattern on
`ConsentController`) as the realistic defense, not entropy alone.

### Flow, end to end

1. Coach taps **"Skicka ny inloggningslänk"** on Screen C2 for a specific
   player → `POST /api/v1/coach/players/:playerId/session-reissue`
   (coach-authenticated; the service checks the player's `team_id` against
   the coach's `TeamCoach` rows, same authorization pattern as every other
   coach-scoped endpoint in the Phase 2 contract).
2. Backend, in one transaction:
   - Increments `player.token_version` — this **immediately invalidates
     every existing token** for that player, everywhere, the moment the
     coach taps the button, independent of whether the code below is ever
     used. This matters for the "lost phone" case: a coach shouldn't have
     to wait for the kid to redeem a new code before the old, possibly
     compromised session stops working.
   - Generates a fresh `session_reissue_code` + 15-minute expiry, storing
     it on the `Player` row (overwriting any unredeemed previous code).
3. Response returns the code to the coach's screen:
   `{ "reissueCode": "H4K7QWXP", "expiresAt": "..." }`. The confirmation
   copy from `phase2-flows.md` ("Ny länk skickad. Visa den för {screenName}
   så de kan logga in igen") needs the code itself rendered prominently —
   flagged for ux-designer/frontend-developer, since the existing copy
   implies something was "sent" but the actual mechanism is "shown on this
   screen," a small copy adjustment worth making explicit rather than
   silently reinterpreting the Swedish.
4. Kid opens a **new player-facing screen** ("Har du tappat inloggningen?
   Ange koden från din tränare") — new frontend build, flagged here since
   Phase 1 has no equivalent screen — and submits the code via
   `POST /api/v1/players/session/redeem { code }` (no auth, same
   unauthenticated-by-necessity category as `POST /players`).
5. Backend validates the code (exists, unexpired, unused — generic
   `invalid_or_expired_code` error otherwise, no hint which), nulls it
   (single-use), and issues a **new** JWT carrying the **current**
   `token_version`. Response mirrors `POST /players`' shape closely enough
   for the client to reuse the same "store token, go home" logic:
   `{ playerId, sessionToken }`.
6. Any previously-issued token for this player — including the very one
   that prompted the reissue — now fails verification (step below), even
   before step 4 happens, because of step 2's bump.

### Verification-flow change — `JwtAuthGuard`

`PlayerTokenService.issueFor` now signs `{ sub: playerId, tokenVersion }`
instead of just `{ sub: playerId }`. `JwtAuthGuard`, after a successful
signature/expiry verification, does one additional check: load the
player's current `token_version` (a single indexed PK lookup — cheap, and
several guarded endpoints already load the full `Player` row immediately
after, e.g. `GET /players/me`) and compare it to the token's `tokenVersion`
claim. Mismatch → the same `UnauthorizedTokenException` used for a bad
signature (no new error code — from the client's perspective this is
identical to "your session is gone, start the redeem flow," it doesn't need
to distinguish *why*).

**Backward compatibility for already-issued Phase 1 tokens:** every player
token minted before this change has no `tokenVersion` claim at all (the
field didn't exist). Treat a missing claim as `tokenVersion: 0` — which is
also the column's default for every existing player row — so the rollout
of this migration doesn't silently invalidate every session already in the
wild. Only tokens issued *after* this ships carry the claim explicitly, and
only a coach's reissue action (which starts a player at `token_version: 1`
and up) ever creates a mismatch.

This DB lookup on every guarded request is a deliberate, accepted cost —
boring and correct beats stateless-but-unrevocable at this project's scale
(a handful of teams, no Kubernetes yet per CLAUDE.md's phase framing). If
load ever makes this measurable, ADR-0002's existing Postgres-then-Redis
caching pattern is the obvious next step (cache `token_version` in Redis,
invalidate the cache key on reissue) — not needed now, flagged for later
rather than built preemptively.

## Consequences

- Three new columns on `Coach` (`password_hash`,
  `password_reset_token`, `password_reset_token_expires_at`), three new
  columns on `Player` (`token_version`, `session_reissue_code`,
  `session_reissue_code_expires_at`) — all additive migrations, nothing
  removed, no data backfill needed beyond defaults.
- A new `backend/` dependency (bcrypt or equivalent) for password hashing —
  small, standard, boring.
- A new `coach-auth` module, structurally parallel to `player-private-info`
  and `consent` — this project's established pattern of one module per
  narrow security-relevant concern, not folding auth into `coaches/`.
- Two JWT secrets to manage in `.env`/`k8s/` instead of one
  (`JWT_SECRET` unchanged, new `COACH_JWT_SECRET`) — a small ops cost for a
  real security boundary between the two token universes.
- Every player-guarded request now does one extra indexed lookup — accepted
  cost, not optimized preemptively (see above).
- New frontend surfaces needed (flagged for frontend-developer/ux-designer,
  not designed in depth here): a player-facing "enter your reissue code"
  screen, and the coach-side display of the returned code on the C2
  confirmation copy.
- Coach account creation/self-serve signup remains an open gap, same shape
  as Phase 1's seed-only team creation — acceptable for Phase 2, worth a
  follow-up once coach onboarding needs to scale past a backend-developer
  seed script.
- security-reviewer should confirm the reissue-code entropy/TTL/throttle
  combination and the password-reset flow (enumeration resistance, reset
  token handling) before this lands, per CLAUDE.md's "auth is always a
  blocking review" rule.

**Everything in this Consequences section describing `Coach`/coach-auth is
superseded — see the addendum below. Everything describing `Player`
(`token_version`, `session_reissue_code`, the extra indexed lookup, the
new frontend "enter your reissue code" screen) stands unchanged.**

## Addendum — 2026-07-05: Coach concept replaced by player-Kapten (Parts 1 & 2 superseded)

The project owner reviewed the coach-dashboard plan this ADR and
`docs/api/phase2-contract.md` were built against and pivoted, in their own
words: *"instead of having a Coach view, the team could set one person in
the team to be the motivator or captain of the team. This person can set
the team's goals for the week and this is the 'Coach view'... And if the
team successfully reach the goal they get extra team points, +5p per team
exercises."* Follow-up answers made this a decision, not an open option:
the player-captain ("Kapten") **fully replaces** the adult-coach concept for
Phase 2 — there is no separate coach login, no second JWT universe, no
`coach-auth` module. Whoever is captain uses their **existing player
account and existing player JWT**.

**What this supersedes, and why:**

- **Part 1 (password-based coach login)** is moot — there's no separate
  credential to authenticate, because there's no separate account. A
  captain is just a player with one extra boolean flag, authenticated the
  exact same way every other player already is.
- **Part 2 (separate coach/player token universe, `COACH_JWT_SECRET`,
  `CoachAuthGuard`)** is moot for the same reason — there is only ever one
  kind of session token in this app now. `AuthModule`/`JwtAuthGuard`/
  `PlayerTokenService` are exactly as they were for Phase 1, with Part 3's
  `token_version` claim, and nothing else.
- No bcrypt dependency gets added. No `backend/src/coach-auth/` module gets
  built. `docs/api/phase2-contract.md`'s coach-login/password-reset
  endpoints and `CoachAuthGuard`/`CoachTeamAccessGuard` are removed from
  that contract, not merely deprecated — see the updated contract.

**What is *not* superseded:**

- **Part 3 (player `token_version` + session-reissue code) stands exactly
  as designed above.** The schema, the code format, the transaction shape,
  the `JwtAuthGuard` verification change, the backward-compatibility
  handling for pre-existing tokens — none of it changes. The only thing
  that changes is *who is authorized to call*
  `POST /.../players/:playerId/session-reissue`: a team's captain (via
  their ordinary player JWT + a service-layer captain check), not a coach
  (via `CoachAuthGuard`). That's a contract-level authorization change,
  specified in `docs/api/phase2-contract.md` and
  `docs/adr/0005-kapten-and-weekly-team-goal.md`, not a change to this
  ADR's Part 3 design.
- The `Coach` and `TeamCoach` entities themselves (already migrated in
  Phase 1, holding no data — no Challenge or coach-auth CRUD was ever
  built against them) are **not deleted**. They're left dormant: CLAUDE.md's
  longer-term product description still mentions a coach dashboard, and a
  real adult-coach login is plausible again in a later phase (e.g. once a
  club wants oversight beyond a single kid-captain). Deleting working
  schema to reintroduce it later would be exactly the kind of churn this
  project's ADRs otherwise avoid. What *does* change is `Challenge`'s
  `created_by_coach_id` column, which no longer has a coach to point to —
  see ADR-0005 for the replacement (`created_by_player_id`).

**Why the pivot is a reasonable call, not just a simplification for its own
sake:** Phase 1 already established that this is a coach-facilitated but
kid-centered app with no adult-facing account system at all — a coach
creates teams/invite codes as a seed/admin action, same as this ADR treated
coach account creation. Building an entire second authentication universe
(Parts 1-2) for a role that, in this pivot, no longer exists as a distinct
account type would have been real, unnecessary complexity: a new
dependency (bcrypt), a new module, a new secret to manage in `.env`/`k8s/`,
and a whole password-reset flow — for a "coach dashboard" that the project
owner has now decided should just be "whichever player is captain, using
the account they already have." This is the boring-option principle
CLAUDE.md asks for, applied one level up: the *cheapest* way to give a team
a goal-setting/roster-viewing screen is to reuse the player auth that
already works, not stand up parallel infrastructure for a role Phase 2
doesn't actually need as a separate identity.

See `docs/adr/0005-kapten-and-weekly-team-goal.md` for the captain data
model, the weekly-team-goal design (reusing the `Challenge` entity), and the
goal-completion bonus mechanic — and `docs/api/phase2-contract.md` for the
resulting endpoint contract.
