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

## Addendum — 2026-07-27: redesign binding redemption to the target player

Both Part 3 routes have sat disabled (`SessionReissueDisabledException`,
`503 session_reissue_disabled`) since the confirmed critical finding in
Phase 2's post-merge review: `POST /players/:playerId/session-reissue`
returned the reissue code directly to whichever caller triggered it,
intended to be relayed in person to the target player, but nothing bound
redemption to the target — so the same captain who triggered reissue
could immediately redeem the code themselves via
`POST /players/session/redeem` and obtain a live session token **for the
target player**, i.e. full account takeover, repeatedly, with no rate
limit or audit trail. This addendum is that redesign, per this project
owner's direct instruction, prompted by a separate, real, confirmed gap
(`docs/PROJECT.md`'s Fas 4 punch list, item 2): a real user tried to
reconnect an existing account on a new session and found no "I already
have an account" path anywhere in the app or website — onboarding
(O1-O6) only ever creates a *new* player.

### The fix: the code goes to `parent_contact`, never to the requester

Whoever triggers a reissue — a captain, or the new self-service entry
point below — never sees the code. `SessionService` now emails it to the
**target player's own `parent_contact`** (via `PlayerPrivateInfoService
.getParentContact`, the same read path `ConsentService`'s reminder-resend
already uses — `PlayersModule` still never imports
`PlayerPrivateInfoModule` directly, per ADR-0002 addendum §1's boundary).
This reuses the exact trust boundary parental consent already relies on:
for an under-13 player that's the actual parent/guardian's inbox; for a
13+ self-verified player (ADR-0002's 2026-07-27 addendum) `parent_contact`
already *is* the player's own verified email, so the code reaches them
directly, no relay needed. Delivery is best-effort — same posture as
every other mail send in this app (`ConsentService
.sendReminderEmailBestEffort`, `OnboardingService`'s initial send): a mail
failure, an unconfigured SMTP relay, or `parent_contact` being a phone
number rather than an email (`parent_contact` accepts either, per
`IsEmailOrPhone` — this app has no SMS pipeline) must never fail the
underlying reissue request itself, and is logged, not surfaced to the
caller. **This is a known, pre-existing, accepted gap carried over
unchanged from the parental-consent flow, not a new one** — a phone-only
`parent_contact` already couldn't complete consent by email either.

Binding redemption to `parent_contact` closes the account-takeover path
regardless of *who* triggers the reissue or *why* — a captain can no
longer redeem a teammate's code because a captain never receives it. This
is what makes it safe to add a second, unauthenticated trigger surface
below without reopening the same hole.

### New: self-service "I already have an account" entry point

The confirmed real gap was hit with no captain in the loop at all — a
player using the website's try-it demo on a fresh session, nobody around
to trigger anything on their behalf. New endpoint,
`POST /api/v1/players/session/reissue-request { inviteCode, screenName }`,
unauthenticated (same category as `POST /players` — the caller has no
session by definition), resolves the target by team invite code +
case-insensitive screen name within that team (a new
`PlayersService.findUniqueByTeamAndScreenName`; returns nothing if zero or
*more than one* case-insensitive match — the existing `(team_id,
screen_name)` unique index is case-*sensitive*, so two players named
`Foo`/`foo` on one team is possible today; refusing to guess which one is
meant is the safe default over a `LIMIT 1`-and-hope). If resolved, it goes
through the exact same reissue mechanism as the captain-triggered route
(see below). **The response is always the same generic
`{ requested: true }`, regardless of whether `inviteCode`/`screenName`
matched anything** — mirroring ADR-0004 Part 1's original password-reset-
request pattern ("always `200`... to avoid confirming which emails have
accounts") — so this can't be used to enumerate valid screen names within
a team. Team invite codes are meant to be shared aloud to recruit
teammates (not a secret), so this endpoint's realistic abuse surface isn't
account takeover (redemption is still bound to `parent_contact`) but
**inbox-spam harassment** — see the cooldown below for the mitigation —
plus a per-IP `@Throttle` on the route itself (mirroring `POST /players`'
`10/min/IP`) as volume-level defense-in-depth. One accepted, unaddressed
gap, consistent with this app's existing risk posture on unauthenticated
identity-probing endpoints (e.g. the invite-code lookup): response time
differs slightly between a match (DB write + transaction + mail send) and
a non-match (one query), a minor timing side channel not being normalized
here.

### Shared mechanism, two trigger surfaces

Both entry points call the same internal `SessionService.performReissue`:
claim a 5-minute per-player Redis cooldown
(`RedisService.tryClaimSessionReissueCooldown`, identical shape to the
existing `tryClaimConsentReminderCooldown`) — **on the captain-triggered
path a claim failure throws a real, visible
`SessionReissueRateLimitedException` (429)**, since the captain is already
authorized and knowing "try again in a few minutes" leaks nothing; **on
the self-service path every failure (cooldown, lookup miss, mail error) is
swallowed and the same generic response returned**, since anything
distinguishable here is exactly the enumeration/harassment surface this
redesign is closing. Then: bump `token_version` + generate a fresh code
inside the same row-locked transaction Part 3 already designed (unchanged
— entropy/TTL/format all stand as originally specified), and best-effort
email it via a new `session-reissue-email.template.ts` (first-person-
adjacent copy explaining someone requested to log back into
`{screenName}`'s account, the code, its 15-minute expiry, and a plain "if
this wasn't you or your child, ignore this — it expires automatically"
line, since an unprompted email like this could otherwise read as
alarming).

**Response shapes change, deliberately.** The captain-triggered route's
response drops `reissueCode` entirely — `{ requested: true, expiresAt }`
— the code is never in an HTTP response body again, anywhere. The new
self-service route returns the flat `{ requested: true }` described above.
`POST /players/session/redeem { code }` (Part 3, unauthenticated,
single-use) is unchanged — the kid still types the code into the app
themselves once they (or their parent) have it from the email, same
interaction as before, just sourced from an inbox instead of read off a
captain's screen.

### What still needs building

Both `SessionController` routes' `SessionReissueDisabledException` throws
are removed and replaced with real handlers, plus the new self-service
route — backend-developer. Frontend surfaces this ADR always anticipated
but Phase 2's disable meant were never built (confirmed via grep at the
time: zero references anywhere in `mobile/src`): a player-facing "enter
your reissue code" redeem screen, a new "Har du redan ett konto?"
self-service entry point on both mobile onboarding and the website (site/
index.html — this is where the real gap was actually hit), and the
captain-facing trigger surface in the roster (K2/K3's reissue action,
previously correctly skipped while disabled). All flagged for frontend-
developer, not designed screen-by-screen here.

Given the history — the last version of this exact mechanism was a
confirmed critical account-takeover bug — this redesign gets a real,
independent security-reviewer pass before it ships, not a self-review,
per CLAUDE.md's blocking-review rule for anything touching auth.

### security-reviewer pass (2026-07-27) — two findings, both addressed

**Confirmed: the core fix holds.** Every response shape was traced end to
end — the code never reaches an HTTP response body under any path,
`triggerReissue` checks the target's team against the requester's
captaincy before any mutation, the self-service endpoint's response is
identical byte-for-byte on every failure path (no enumeration tell), the
email template HTML-escapes the code, and a mail-send failure never rolls
back the already-committed `token_version` bump/code write.

- **CONFIRMED, fixed before shipping — unauthenticated harassment DoS.**
  `POST /players/session/reissue-request` needs no secret (invite codes
  are meant to be shared; screen names are visible to any teammate via the
  roster), and the 5-minute burst cooldown alone still allowed ~288 forced
  session-invalidations + parent_contact emails per day for one player —
  the exact same "burst-only, no sustained-volume cap" gap this codebase
  already found and fixed for consent-reminder resends (Phase 2.5's
  review), recommending "a daily cap per target (e.g. 3/day)". Applied
  here verbatim: `RedisService.tryClaimSessionReissueDailyCap`, a 3/day
  fixed-window counter checked *after* (not parallel with) the burst
  cooldown, so a burst-blocked attempt never consumes the daily budget —
  see `SessionService.performReissue`.
- **CONFIRMED, accepted as a known limitation, not fixed** — a case-
  variant screen-name duplicate on a team (the `(team_id, screen_name)`
  unique index is case-sensitive; the self-service lookup is
  case-insensitive) silently and permanently disables self-service
  reissue for the affected player(s), since `findUniqueByTeamAndScreenName`
  correctly refuses to guess which one is meant and the endpoint's
  response is always generic either way. Not fixed by enforcing
  case-insensitive uniqueness at onboarding — a separate, broader behavior
  change outside this redesign's scope. Real but narrow: the
  captain-triggered path resolves by player ID from the roster, never by
  screen-name lookup, so it's unaffected and remains a working fallback.
  See `PlayersService.findUniqueByTeamAndScreenName`'s comment.
