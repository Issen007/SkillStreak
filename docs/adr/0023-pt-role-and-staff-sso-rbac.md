# 0023 - PT/coach role (Fas 5 item 2) and multi-tenant staff SSO/RBAC (admin + PT) — supersedes ADR-0022 Decision 2

## Status

Proposed — 2026-08-03. This ADR does two entangled things, requested
together by the project owner, and each needs its own weight of review
before anything downstream proceeds:

1. **Part A (Decisions A1-A7) formally starts the review
   `docs/PROJECT.md`'s Fas 5 item 2 has explicitly required since it was
   first written**: *"Störst och mest osäker idé i den här fasen —
   återinför en typ av vuxen-auktoritet över barn som redan en gång
   byggdes bort... kräver en riktig arkitekt-/säkerhetsgenomgång innan
   design ens påbörjas"* ("the biggest and most uncertain idea in this
   phase... reintroduces a kind of adult authority over children that was
   already once built away... requires a real architect/security review
   before design even starts"). The project owner has now directly
   confirmed starting that review (*"Yes, formally start that review
   now"*). **Part A needs a blocking security-reviewer pass of at least
   the weight ADR-0019 (the public Shorts feed) got** — a comparable
   "new adult authority over a specific child's specific data" question,
   argued from scratch, not inferred from a lighter precedent. Nothing in
   Part A should be built before that pass.
2. **Part B (Decisions B1-B6) replaces ADR-0022 Decision 2 outright** —
   password-based single-admin login is replaced by federated SSO
   (Google/Microsoft/Apple) for a new, small `admin`/`pt` role system.
   **Part B needs a blocking security-reviewer pass at least at
   ADR-0022's own level** (full weight, the ADR-0010/0018/0019 category,
   not ADR-0020's lighter scoped gate) — it is replacing that ADR's entire
   authentication mechanism, not extending it.

**Explicit, load-bearing statement of what does and does not change in
ADR-0022**: this ADR supersedes **only** ADR-0022 Decision 2 (admin
authentication mechanism). **Decisions 1, 3, 4, 5, 6, 7, 8, 9, and 10 of
ADR-0022 are unchanged, unaffected, and remain the design record for
everything they cover** — the usage-stats/error-log/bug-report/
planning-docs pillars, their reachability posture, their consent
reasoning, their schema, and their aggregate-only floor all stand exactly
as written. Only *who can log in* (Decision 2) and, as a consequence,
*what a logged-in session can now optionally see beyond ADR-0022's own
scope* (Decision B4 below, the PT data path) change. A short addendum has
been added to `docs/adr/0022-admin-control-center.md`'s Status section
pointing here — see that file.

Part A depends on Part B's `StaffAccount`/SSO/RBAC mechanism to have
something for a PT to log into at all — they are designed together in one
ADR for that reason, not because they're the same review question. A
security-reviewer could in principle clear Part B before Part A if the
project owner wants to sequence the work that way (Part B has no
dependency on Part A being accepted); Part A cannot ship without Part B.

**Security-reviewer pass — Part B, full ADR-0022 weight, 2026-08-03 — not a
clean sign-off.** Decisions B3 (environment-parity/offline dev-session
script), B4 (RBAC guard shape), B5 (no CAPTCHA), and B6 (OIDC client
library choice) confirmed sound as written. Four findings:

- **CONFIRMED, most severe**: removing an email from `ADMIN_EMAILS`
  didn't revoke an already-issued admin session — Decision B1's original
  "re-derived at login, bounded by session lifetime" language cited
  `token_version` (ADR-0004 Part 3) backwards, as precedent for
  *accepting* staleness, when that mechanism's actual point is a real
  per-request DB check that gives *immediate* revocation. Given "admin =
  access to everything" is the whole point of this role, and this project
  has already built real immediate-revocation precedent for the
  much-lower-stakes player case, this needed a real fix, not a softer
  claim. **Fixed**: `AdminAuthGuard` now performs a per-request
  `StaffAccount` lookup (checking `revoked_at IS NULL` and, for
  Google/Microsoft accounts, re-comparing the account's current email
  against the live `ADMIN_EMAILS` config) rather than trusting the JWT's
  `role` claim or the stored `role` column — see the revised Decision
  B1/B2 text below. `PtAuthGuard` does not need the equivalent check: a
  freshly-provisioned `pt`-role account already carries zero ambient
  authority by construction (Decision A1), so there is no "removed from an
  allow-list but the session still grants everything" gap on that side to
  close.
- **CONFIRMED**: Apple's OIDC only ever includes the `email`/`name`
  claims on a user's very first authorization with this app — every
  subsequent Apple login omits both, with no way to fetch them later.
  Decision B1's "re-derived from the live email claim on every login" had
  no live email to check for any Apple login after the first. **Fixed**:
  a named exception is added to Decision B1 — `StaffAccount.email` for an
  Apple-authenticated account is persisted once, at first login, and
  treated as authoritative thereafter (never "refreshed every login," the
  Google/Microsoft behavior); `ADMIN_EMAILS` matching for an
  Apple-authenticated account therefore only ever happens meaningfully
  once, at account creation, and revoking an Apple-authenticated admin (or
  suspending an Apple-authenticated PT for cause) goes through the new
  `StaffAccount.revoked_at` column, not through editing `ADMIN_EMAILS`.
- **PLAUSIBLE**: no mention anywhere of OAuth `state`/PKCE/nonce.
  **Fixed**: added as an explicit, named requirement to Decision B6,
  likely satisfied by `openid-client`'s own defaults but now stated
  rather than assumed, with an explicit ask for backend-developer to
  confirm it with a test.
- **PLAUSIBLE, minor**: Decision B5's bot-verification argument didn't
  explicitly tie "no form to protect" to Part A's own "PT defaults to
  zero linked players/teams" design. **Fixed**: one sentence added to
  Decision B5 connecting the two.

Net: backend-developer may build Part B as amended.

**Security-reviewer pass — Part A, ADR-0019 weight, 2026-08-03 — not a
clean sign-off.** Decisions A2 (two-step link/consent chain), A3 (mailed
review-and-approve mechanism, contact-change-hijack-race fix), A4
(three-party revocation), and A6 (cross-team-reach argument) confirmed
sound as written. Three findings:

- **Medium, most severe in Part A**: a child joining a team *after* a PT
  is already linked is exposed to that PT's team-aggregate view (screen
  name + consent status) automatically, with no fresh consent action by
  anyone — contradicting Decision A1 point 5's own claim that "access
  silently expanding... structurally cannot happen here." That claim is
  true for the per-player training-data tier but was false as stated for
  the team-aggregate tier. **Decided explicitly**: accepted as the
  intended design for the team-aggregate tier specifically (screen name +
  consent status only, no worse than existing teammate-roster visibility,
  and consistent with Decision A6's own already-accepted residual for the
  same tier) — Decision A1 point 5's overclaiming language is corrected to
  scope its "cannot happen" claim to the per-player training-data tier
  only, where it remains true without exception.
- **Low**: `GET /api/v1/pt/players/:playerId/consent-status` didn't
  restate the same active-`PtTeamLink` authorization check its sibling
  write endpoint (`POST .../consent-requests`) explicitly has, leaving a
  PT with zero active team links able to probe/enumerate consent-status
  for arbitrary player IDs app-wide. **Fixed**: the identical guard/check
  added explicitly to this endpoint's spec.
- **Low, wording only**: the PT data allow-list table's `BadgeAward`
  justification could be misread as implying `context` (including its
  freeform coach-authored `note` subfield, confirmed real in
  `backend/src/badges/dto/badge-award-context.dto.ts`) is
  included-but-safe, rather than excluded. **Fixed**: wording tightened to
  state the exclusion explicitly — no design change.

Net: backend-developer may build Part A as amended, once Part B's account
mechanism exists per this ADR's own sequencing.

**Amendment, 2026-08-10 — Part C: a player account may link to a trainer
account.** Appended at the end of this file, and **not yet reviewed**: it
adds one join table, one linking flow and one exclusion rule on top of
Parts A and B, changes no decision above, and is blocking on its own
`security-reviewer` pass (it touches auth *and* child data). See
"Amendment — 2026-08-10: Part C" below.

## Context

Two verbatim requests from the project owner, across separate messages,
both treated as firm scope here:

> "I want to also to have static so we can in the future sale our Personal
> Traning functions and coche functions." (2026-08-02, `docs/adr/
> 0022-admin-control-center.md`'s own Context — the PT/coach angle was
> named there as *why this matters*, explicitly not designed there.)

> "For our OBS login, this should a multitenent RBAC function. Where our
> PT have their own login an can track their numbers, and for me as Admin
> should have access to everything." (2026-08-02/03, when ADR-0022's
> control-center work reopened the question directly.)

Follow-up, clarifying two of Part B's open technical questions directly,
treated as firm constraints, not preferences:

- **SSO only, no custom password, no custom email-OTP MFA** — "rely on
  their security and not create our own," the project owner's own stated
  reasoning when asked directly to choose between building a second
  factor ourselves versus delegating entirely to Google/Microsoft/Apple.
- **Human/bot verification (CAPTCHA-style) wanted for PT/admin account
  creation and login specifically — explicitly not for players**,
  confirmed directly when asked. Players are out of scope for every
  decision in this ADR.

**What already exists, load-bearing, read directly before drafting:**

- **`docs/adr/0022-admin-control-center.md`** — Decision 2's superseded
  mechanism (single hardcoded credential, bcrypt, `ADMIN_JWT_SECRET`, an
  httpOnly `SameSite=Strict` cookie) and its own already-reviewed
  reasoning for *why a cookie, not a bearer token* (XSS is the realistic
  threat for an ordinary browser page with no legitimate reason for page
  JS to read the session), which this ADR reuses verbatim rather than
  re-deriving (Decision B2). Decisions 1/3/5/6/7/8/9/10's data pipelines,
  reachability posture, and consent reasoning are the unchanged backdrop
  Part B's new guard has to keep serving correctly.
- **`docs/adr/0004-coach-auth-and-session-reissue.md`** — the original
  coach-dashboard design (Parts 1-2: password login, a full separate
  coach/player token universe) that Phase 2's pivot superseded. That
  addendum's own account of *why* it was superseded is the single most
  load-bearing fact for Part A: the objection was never "adult login is
  inherently unsafe here," it was **"a new class of adult standing
  authority over specific children's specific data/accounts that could
  grow"** — an extensible authority (invite more coaches, grant them more
  teams/rosters/challenge-authoring/session-reissue-triggering power) with
  no per-child opt-out. Part A's Decision A1 answers, point by point,
  whether a PT role is that same shape of risk or a bounded, different one.
- **`docs/adr/0019-public-shorts-feed.md` Decision 1** — the closest
  existing precedent for "a new, materially stronger consent step for a
  specific new use of a specific child's data," layered on top of, never
  replacing, account-level consent: a parent (or, for the 13+
  self-verification cohort, the player themself) must open a mailed link,
  actually see what's being asked, and explicitly approve *before* a
  specific new audience gains visibility into a specific child's content.
  Part A's Decision A3 argues this is the right bar for a PT relationship
  too, not ADR-0018 Decision 3's lighter "disclosure, not a new gate" bar.
- **`docs/BACKLOG.md`'s "PT/Tränare-roll" framing and "Points system needs
  a verification/inspiration tier... PT growth-loop" entry**, and
  `docs/PROJECT.md`'s Fas 5 item 2 — the raw product framing: a team can
  bring in its own PT, with an eye toward a paid plan, and a PT plausibly
  builds a cross-team following (video archive, promoting their own
  coaching business) as a user-acquisition loop. **The monetization/paid-
  plan angle is named as *why this matters*, exactly as it was for
  ADR-0022 — this ADR does not design billing/payments, subscriptions,
  or the PT↔team financial-services question `docs/BACKLOG.md` already
  flags as "architecture not yet decided, treat as high-risk until it
  is."** Same posture ADR-0022 took toward the PT feature itself: named as
  context, not designed here.
- **`docs/adr/0002-data-model.md`** (`Team`/`Player`/`PlayerPrivateInfo`/
  `TrainingLogEntry`, the individual-streak-vs-team-pool split) and
  **`docs/adr/0005-kapten-and-weekly-team-goal.md`** (the kapten/captain
  concept) — a PT is a **structurally different shape** from a captain,
  stated explicitly so a future contributor doesn't reach for the
  captain's authorization pattern by reflex: a captain is a **peer**
  (another child on the *same* team, gaining zero data access beyond what
  every teammate's own roster view already shows, per ADR-0005/0006/0010's
  repeated, deliberate refusal to give a captain any authority over
  another player's *content*). A PT is an **adult**, is **not a member of
  any team**, and per the request, plausibly works across **multiple**
  teams a player's own teammates have no relationship to at all. Every
  authorization pattern in this codebase so far (`assertIsCaptainOfTeam`,
  `TeamCoach` membership) assumes the actor is scoped to exactly one team
  it already belongs to — a PT needs a genuinely new authorization shape,
  not a reuse of either existing one.
- **`k8s/secret.yaml.example`/`k8s/configmap.yaml`** — the existing
  per-cluster `Secret`/`ConfigMap` convention this ADR extends for OAuth
  client credentials and the admin-email allow-list, not a new mechanism.
- **`CLAUDE.md`'s environment-parity section** — the `prerelease` →
  `ubuntu01` internal cluster has **no TLS and no public DNS at all**
  (`192.168.55.x`, LAN-only). OAuth redirect URIs are provider-registered
  and (for two of the three providers, absolutely for the third) require
  real HTTPS under a real, resolvable domain — Decision B3 is the honest
  reckoning with this, not an assumption it works the same as every other
  backend feature that's just `ConfigService.get(...)` at request time.

## Part B — multi-tenant staff SSO/RBAC (admin + PT)

### Decision — B1: `StaffAccount` — one new entity, shared by both roles, provisioned entirely by SSO

**A new entity, deliberately not named `Coach`/`AdminUser`/`Trainer`.**
Naming-collision awareness, per this codebase's own established practice
(ADR-0005's `Challenge` naming note, ADR-0021's `taggedPlayerId` note):
`Coach`/`TeamCoach` already exist in this schema, dormant since Phase 2's
pivot, deliberately **not deleted** because "a real adult-coach login is
plausible again in a later phase" (ADR-0004's addendum). Naming this
entity `Coach` would collide with that still-open possibility and wrongly
imply a PT *is* the old coach-dashboard concept revived — it isn't (no
roster-editing authority, no challenge-authoring authority, no
session-reissue-triggering authority; see Decision A1). `AdminUser` would
underclaim what the entity now holds (two roles, not one). `StaffAccount`
is chosen as a neutral umbrella term for "an adult who logs into this
app's non-player-facing surfaces," leaving `Coach` free for whatever it
might mean if it's ever revived, and leaving room for a third role later
(the entity's `role` column is a Postgres enum specifically so adding one
is a small, reviewable migration, not a schema redesign).

```
StaffAccount
  id                     uuid, PK
  role                   enum('admin', 'pt'), not null   -- a last-known,
                                                            display-only
                                                            snapshot,
                                                            refreshed at
                                                            login for
                                                            Google/Microsoft
                                                            (see the
                                                            'refreshed every
                                                            login' note on
                                                            `email` below)
                                                            or set once at
                                                            first login for
                                                            Apple — never the
                                                            sole basis for an
                                                            authorization
                                                            decision, see the
                                                            revised
                                                            `AdminAuthGuard`
                                                            text below
  auth_provider          enum('google', 'microsoft', 'apple'), not null
  auth_provider_subject  varchar, not null   -- the OIDC 'sub' claim, this
                                               -- provider's own stable
                                               -- identifier for the account
  email                  varchar, not null   -- from the verified ID token
                                               -- 'email' claim, refreshed at
                                               -- every login for Google/
                                               -- Microsoft; for Apple, set
                                               -- once at first login only
                                               -- and never refreshed again
                                               -- (Apple omits the 'email'
                                               -- claim on every login after
                                               -- the first — see the named
                                               -- exception below) — never
                                               -- user-editable in this app
  display_name           varchar, nullable   -- from the ID token 'name'
                                               -- claim, refreshed each login
                                               -- for Google/Microsoft, set
                                               -- once for Apple, same
                                               -- reasoning as `email`
  revoked_at             timestamptz, nullable   -- explicit, manual staff-
                                                    account suspension lever
                                                    (added per
                                                    security-reviewer's Part
                                                    B pass, Finding 1/2 —
                                                    see Status) — set
                                                    directly (e.g. via
                                                    Postgres access, the same
                                                    "operator already has
                                                    direct DB access" lever
                                                    ADR-0020/0022 already
                                                    rely on) to end a
                                                    specific StaffAccount's
                                                    every current and future
                                                    session immediately,
                                                    regardless of whether its
                                                    email still matches
                                                    `ADMIN_EMAILS` — the only
                                                    reliable revocation lever
                                                    for an
                                                    Apple-authenticated
                                                    account, whose persisted
                                                    email may be frozen or
                                                    may be an Apple
                                                    "Hide My Email" relay
                                                    address never
                                                    meaningfully editable in
                                                    `ADMIN_EMAILS`
  created_at              timestamptz, not null
  last_login_at           timestamptz, not null
  UNIQUE (auth_provider, auth_provider_subject)
```

**Never stores a raw OAuth access/ID/refresh token at rest** — this table
exists to answer "who is this, durably" (a stable local ID + role +
linked-relationship rows, per Decision A-series), not to hold a live
provider credential this app has no ongoing use for. The provider token
is used exactly once, synchronously, inside the callback handler (to fetch
the ID token's claims and, for the very first login only, provision this
row) and is then discarded — the session itself is this app's **own**
signed cookie (Decision B2), never the provider's token forwarded around.

**How someone becomes `admin`**: a small, explicit **allow-list of admin
email addresses**, in config, checked at **every** login (not just first
login — see below for why). **Recommended, not "first person to sign
up"** — the task's own instruction names this as a real security hole,
and it's the same class of mistake ADR-0022 Decision 2 already avoided by
using a hardcoded credential rather than an open self-registration form.
New `Secret` entry `ADMIN_EMAILS` (comma-separated, case-insensitively
matched against the verified `email` claim), following `ADMIN_USERNAME`'s
existing precedent of living in `skillstreak-secret` rather than the
non-secret `ConfigMap` — not because an email address is cryptographically
sensitive, but because *whose* email is on this list is exactly the kind
of operationally-sensitive fact `k8s/secret.yaml.example`'s existing
`ADMIN_USERNAME` entry already treats the same way, and putting it
anywhere else would be an inconsistent, unargued exception.

**How someone becomes `pt`**: **self-service, via SSO, defaulting to zero
linked players or teams.** Any successful SSO login whose email is **not**
on `ADMIN_EMAILS` auto-provisions a `StaffAccount` row with `role = 'pt'`
on first login (no invite code needed to create the *account* — the
invite code, Decision A2, gates the account gaining any actual team/player
*relationship*, not its existence). **This default-zero-access posture is
argued, not assumed**: a `pt`-role `StaffAccount` with no `PtTeamLink` and
no `PtPlayerConsent` rows can read **nothing** about any player or team —
every one of Decision A-series's read endpoints is gated on a live,
specific relationship row existing and being active, never on `role = 'pt'`
alone. This mirrors this codebase's now-standard "structural, not
policy" floor (ADR-0022 Decision 5's "no `teamId`/`playerId` in the method
signature at all" bar, ADR-0019's "re-check live status on every read, never
trust a cached grant" bar) — a freshly-signed-up PT account is, by
construction, indistinguishable in capability from someone who never
signed up at all, until Part A's own consent chain grants something
specific.

**Role is re-derived live, on every request, not merely at login — a
correction to this ADR's original draft, folded in per security-reviewer's
Part B pass (Finding 1, documented in full in Status).** The original
draft claimed role staleness was bounded to "at most one session
lifetime," reasoning by analogy to `token_version`'s per-request DB check
(ADR-0004 Part 3) — but the analogy was backwards: `token_version`
achieves *immediate* revocation precisely because `JwtAuthGuard` re-checks
it on every request (verified directly in
`backend/src/auth/jwt-auth.guard.ts`), not because staleness is an
accepted trade. This ADR now does the same for admin authority
specifically, the highest-stakes case ("admin = access to everything," per
the project owner's own framing): **`AdminAuthGuard` never trusts the
JWT's `role` claim or the `StaffAccount.role` column as authoritative** —
on every request it (a) rejects immediately if `StaffAccount.revoked_at`
is non-null, and (b) for Google/Microsoft-authenticated accounts,
re-compares the account's current `email` against the **live**
`ADMIN_EMAILS` config value (an in-memory `ConfigService` read, not a DB
round trip — genuinely free) before granting admin authority for that
request. Removing an email from `ADMIN_EMAILS` (plus the pod restart that
value already requires to take effect, the same operational step every
other `Secret` rotation in this app already requires) now revokes admin
authority on the very next request across every outstanding session — no
waiting for a session to expire or for the affected person to log in
again. The `StaffAccount.role` column and the JWT's own `role` claim
remain useful as a last-known/display value (e.g. "you are signed in as
admin" in the admin UI), refreshed at login, but are never the basis for
an authorization decision. See Decision B2's revised `StaffAuthGuard`/
`AdminAuthGuard` text for the guard mechanics.

**Apple is a named exception, not silently covered by the above (Finding
2, documented in full in Status)**: Apple's OIDC only includes the
`email`/`name` claims on a user's very first authorization with this app
ever — every subsequent Apple login omits both entirely, with no way to
fetch them later (a hard platform constraint, not a bug to route around).
`StaffAccount.email` for an Apple-authenticated account is therefore set
once, at first login, and treated as authoritative from then on — **not**
"refreshed every login," unlike Google/Microsoft. Consequently,
`ADMIN_EMAILS` matching for an Apple-authenticated `StaffAccount` only
ever happens meaningfully once, at account creation (the first login is
the only point a live email claim exists to check against the allow-list
at all) — there is no meaningful "next login" re-check for this provider
to rely on. The live per-request check above still runs for an Apple
account (it compares the *persisted* email, not a fresh claim), but its
reliability is bounded by how accurate and matchable that persisted email
remains (Apple's own "Hide My Email" relay-address option can make it a
non-human-readable string an operator can't confidently maintain in
`ADMIN_EMAILS`). **For this reason, revoking an Apple-authenticated admin
(or suspending an Apple-authenticated PT for cause) must go through
`StaffAccount.revoked_at`, not through editing `ADMIN_EMAILS`** — editing
the allow-list remains the correct, sufficient lever for Google/Microsoft
accounts, but isn't guaranteed to be a meaningful action for an Apple one.

### Decision — B2: session mechanism — reuses ADR-0022 Decision 2's cookie reasoning verbatim, generalized to carry a role and an account ID

**Still an httpOnly, `SameSite=Strict` cookie, not a bearer token — that
reasoning is not SSO-specific and is not re-derived here.** ADR-0022
Decision 2 already argued, and security-reviewer already confirmed
(with the `SameSite`-scope wording correction that stands as written),
that an ordinary browser page with a real operator's real session and no
legitimate reason for page JS to read the token should use an httpOnly
cookie over a bearer-in-`localStorage` pattern, for the identical XSS-vs-
CSRF trade this ADR inherits unchanged.

**What changes**: the payload and secret naming, to reflect that this is
now a small multi-account, multi-role system, not "the one admin":

- **New secret name, `STAFF_JWT_SECRET`, replacing `ADMIN_JWT_SECRET`**
  (a rename, not an addition — `ADMIN_JWT_SECRET` never shipped to
  production, since ADR-0022's own backend-developer step was still
  unchecked when this ADR was written; there is no live-migration
  concern). Still a secret wholly independent of the player `JWT_SECRET`,
  for the identical structural-boundary reason ADR-0004 Part 2 and
  ADR-0022 Decision 2 already established (signature verification fails
  outright across the boundary, before any claim is inspected).
- **Payload**: `{ sub: staffAccountId, role: 'admin' | 'pt' }` — no team or
  player list embedded (mirroring ADR-0004 Part 2's `Coach` JWT reasoning:
  a PT's actual linked players/teams are re-derived from `PtTeamLink`/
  `PtPlayerConsent` on every request, never baked into the token, so
  revoking one specific relationship — Decision A4 — never requires
  reissuing a session).
- **Cookie name/scope**: renamed from an admin-specific name to a neutral
  `staff_session`, `Path=/api/v1` (broadened from ADR-0022's
  `Path=/api/v1/admin`, since it now also needs to ride along to the new
  `/api/v1/pt/*`/`/api/v1/staff-auth/*` routes below — still narrower than
  the default `Path=/`, the same "cheap to scope correctly" instinct
  ADR-0022 Decision 2 already applied).
- **Lifetime**: unchanged recommendation, 24 hours — still short relative
  to the player JWT, still argued the same way (infrequent operator/PT
  use, not a kid's always-on session), and now also doubles as the bound
  on `ADMIN_EMAILS`/role-staleness above.
- **`ADMIN_COOKIE_SECURE`-equivalent config value stands unchanged**
  (rename to `STAFF_COOKIE_SECURE` for consistency, same per-cluster
  `ConfigMap` value, same reasoning: `ubuntu01` has no TLS, so a
  `Secure`-flagged cookie would silently never be sent there).
- **`StaffAuthGuard`**: verifies the cookie's signature against
  `STAFF_JWT_SECRET` and expiry only, and populates
  `request.staffAccountId` and the token's original `role` claim (kept as
  a hint only, see below) — still no per-request DB lookup at this base
  layer, the identical cheap "signature + expiry only" shape ADR-0022
  Decision 2 already established.
- **`AdminAuthGuard` (Decision B4), specifically, adds one more step this
  ADR's original draft omitted, required by security-reviewer's Part B
  pass (Finding 1, see Status)**: a per-request `StaffAccount` lookup by
  `staffAccountId`, checking `revoked_at IS NULL` and (for Google/
  Microsoft accounts) re-comparing the row's current `email` against the
  live `ADMIN_EMAILS` config before granting admin authority for that
  request — see Decision B1's revised role-derivation text for the full
  reasoning and the named Apple exception. This is a real, not cached,
  per-request DB read, mirroring `JwtAuthGuard`'s `token_version` check
  (ADR-0004 Part 3) rather than the "accept bounded staleness" trade the
  original draft wrongly modeled this on — proportionate here because
  admin traffic is low-volume, infrequent operator use, not the
  high-volume player request path `token_version`'s own cost trade-off was
  weighed against. **`PtAuthGuard` does not add this same per-request
  lookup**: a `pt`-role session carries no ambient authority beyond
  "may attempt to redeem a team-invite code or request per-player
  consent," both already gated by their own live relationship checks
  (Decisions A2-A5) — there is no equivalent "removed from an allow-list
  but the session still grants everything" gap on that side to close.

### Decision — B3: environment-parity reckoning — full three-provider OAuth cannot be genuinely tested on `ubuntu01`; don't build a live bypass endpoint to compensate, use an offline dev-session-minting script instead

**The problem, stated plainly rather than assumed away**: OAuth/OIDC
redirect URIs are provider-registered per client, and the three named
providers do not treat "a private LAN IP with no TLS" the same way:

- **Google** — accepts `https://` redirect URIs, and separately makes a
  narrow exception for `http://localhost`/`http://127.0.0.1` for local
  development. It does **not** extend that exception to an arbitrary LAN
  IP like `192.168.55.71` over plain HTTP.
- **Microsoft (Entra ID)** — same shape of constraint: `https://` required
  in general, with a `localhost` development exception; no LAN-IP-over-
  HTTP exception.
- **Apple (Sign in with Apple)** — the strictest of the three: registered
  redirect URIs must be `https://` under a domain Apple can verify
  ownership of via a hosted well-known file. There is **no** localhost or
  IP-literal exception at all — Apple sign-in categorically cannot be
  wired to a bare LAN IP, TLS or not.

Even where a provider would technically tolerate a self-signed-cert,
IP-literal HTTPS endpoint (Google/Microsoft, in principle), that's a
fragile, inconsistent, easy-to-misconfigure setup for routine internal
testing, and it still doesn't cover Apple at all — a "sometimes works"
three-provider story is worse than an honestly-scoped gap.

**Decision, argued, not assumed**: **do not attempt full, live,
three-provider OAuth handshake testing on `prerelease`/`ubuntu01` at
all.** Two of the task's three named candidates are combined, not chosen
in isolation:

1. **The OAuth handshake itself is provider-configuration-dependent, not
   cluster-dependent application logic** — the code path
   (`StaffAuthController`'s callback handler, claim parsing,
   `StaffAccount` provisioning/role-derivation) is identical regardless of
   which cluster it runs on; what differs per-environment is only the
   registered redirect URI and which `Secret` holds the client
   credentials. This part is adequately exercised via `docker-compose`/
   `localhost` (where Google/Microsoft's own `localhost` exception applies
   directly) plus the existing CI docker-compose smoke test — a real gap
   for Apple specifically (no localhost exception at all), accepted and
   named below.
2. **A first real, careful verification pass happens against `main`'s own
   real HTTPS domain** (`api.skillstreak.xyz`) before PT signup opens to
   real external users — mirroring how this project already treats "the
   first genuine end-to-end proof has to happen against the real domain,
   not staging" for other environment-sensitive features (`k8s/README.md`'s
   own TLS section: `letsencrypt-staging` proves the ACME flow works,
   `letsencrypt-prod` is still a separate, required confirmation before
   trusting it for real traffic). Staff accounts here are project-owner-
   and PT-controlled test/real accounts, not children — unlike every other
   feature in this app, a first real-domain test of this specific flow
   carries no child-data risk.
3. **For everything downstream of a valid session — RBAC scoping, the PT
   per-player summary view, the admin console reusing this new guard —
   `ubuntu01` still needs a way to obtain one**, since that cluster's whole
   purpose is exercising real, deployed application logic before
   `prerelease` → `main`. **Recommendation: a small, offline CLI script**
   (e.g. `backend/src/scripts/mint-dev-staff-session.ts`), mirroring the
   exact precedent this codebase already has for "set a piece of
   privileged state without building a full flow for it" — ADR-0004/0005's
   Coach/captain-assignment seed scripts. Given a `(role, email)` and
   direct possession of that cluster's `STAFF_JWT_SECRET` value, it prints
   a valid, signed cookie value a developer can paste into their browser
   manually while testing `ubuntu01`.

**Why an offline script, not a config-flag-gated live bypass
endpoint — argued explicitly, this is the actual decision the task asked
for, not a default**: a network-reachable "dev login" route, even gated by
a boolean config flag defaulting to `false` and even double-checked
against `NODE_ENV !== 'production'`, is a **standing, deployed piece of
attack surface whose entire safety depends on a flag/environment check
never being wrong** — precisely the bug class behind a large fraction of
real-world authentication-bypass CVEs ("a debug/dev login path that got
left reachable in production"). This project has already lived through one
confirmed critical account-takeover finding in an adjacent area (ADR-0004's
2026-07-27 addendum, the session-reissue redemption-binding bug) and has
since adopted a demonstrably more cautious posture toward anything
auth-adjacent. An offline script has **no network endpoint to forget to
disable**: the capability it grants ("mint a valid session for testing")
requires the exact same thing every other credential-rotation action in
this app already requires — direct possession of the cluster's own
`Secret` (`STAFF_JWT_SECRET`), i.e., someone who already has `kubectl`/
`Secret`-read access to that specific cluster. This is the identical "no
new access to a new party" argument ADR-0022 Decision 2 already made for
the admin account itself, applied here to a testing tool rather than a
production credential — and it is categorically safer than the live-
endpoint alternative because there is no deployed code path for a
misconfiguration to leave reachable.

**Consequence, stated plainly**: PT/admin SSO login itself is **not**
feature-tested end-to-end against `ubuntu01` for two of the three
providers under realistic conditions, and **not at all** for Apple
regardless of provider. This is a real, accepted, named gap — the same
"named residual, not silently absorbed" standard every other ADR in this
project already holds itself to (ADR-0016/0020's bucketing residuals,
ADR-0019's presigned-URL residual) — closed instead by a first careful
real-domain test before real PT signup opens, per point 2 above.

### Decision — B4: RBAC enforcement shape — two small, single-purpose guards, not a generic role framework; the PT data path is structurally separate from ADR-0022's aggregate-only floor, stated explicitly so the two are never conflated

**Two guards, `AdminAuthGuard` and `PtAuthGuard`, both built on the same
`StaffAuthGuard` base (Decision B2) that verifies the cookie and populates
`request.staffAccountId`/`request.staffRole`, each adding exactly one
extra check: `staffRole === 'admin'` or `staffRole === 'pt'`
respectively.** Not a generic `RolesGuard`/`@Roles(...)` decorator
framework — this app has exactly two roles today, and ADR-0004 Part 2
already made and argued this identical call for coach-vs-player ("two
small, single-purpose guards is the boring option here, not the
impressive unified one... coach and player routes are already structurally
disjoint"). `admin`/`pt` routes are equally disjoint by URL prefix
(`/api/v1/admin/*` vs `/api/v1/pt/*`) — nothing here needs per-route
dynamic role metadata.

**`AdminAuthGuard` is a drop-in replacement inside ADR-0022's existing
Decisions 4/6/7/10** — every endpoint those Decisions already specify
(`GET /api/v1/admin/usage-metrics`, `GET/PATCH /api/v1/admin/errors` &
`/bug-reports`, the three `planning/*` endpoints) keeps its exact shape,
query/response types, and consent reasoning; only the guard's internal
verification changes, from "one hardcoded credential" to "a `StaffAccount`
row whose current role is `admin`." **No query, schema, or data-shape
change anywhere in ADR-0022 Decisions 1-10 is required by this ADR.**

**Explicit reconciliation, per this project's own "argue, don't leave
ambiguous" standard — these are two different data paths, not one
pipeline with two viewers:**

- **`UsageMetricsService` (ADR-0022 Decision 4/5, `admin`-only)** answers
  "how is the app as a whole doing" — its aggregate-only floor (no
  `teamId`/`playerId` anywhere in its method signatures or return types)
  was designed for, and remains scoped to, a **single viewer with no
  legitimate reason to ever see a per-player breakdown**. Nothing in this
  ADR touches that floor, loosens it, or gives `pt`-role accounts any
  access to it at all — a `pt`-role `StaffAccount` cannot call
  `GET /api/v1/admin/usage-metrics` (blocked by `AdminAuthGuard` itself,
  before any data question even arises).
- **The PT data path (Decision A2's `PtTeamLink`/`PtPlayerConsent`,
  Decision A5's read endpoints) is a wholly separate service, wholly
  separate tables, gated by `PtAuthGuard` plus a live relationship check
  (Decision A5) — not a drilldown into `UsageMetricsService` at all.** Its
  entire purpose is exactly the per-player visibility Decision 5's floor
  was built to prevent for the *other* pipeline — that is not a
  contradiction, because it is answering a structurally different
  question ("what has this specific, consented child's account done,
  visible to this specific, consented adult") under a completely
  different, per-relationship consent gate that `UsageMetricsService` was
  never subject to and never will be. **Stated explicitly so a future
  contributor doesn't read "PT can see per-player data" and conclude
  ADR-0022 Decision 5's aggregate floor was wrong or should be loosened —
  it wasn't, and it shouldn't be.**
- **Admin's "access to everything," per the project owner's own words,
  extends to this second pipeline too — by removing the caller-scoping
  restriction, not by bypassing the underlying consent gate.** Concretely:
  the same underlying `PtDataService` methods Decision A5 defines are
  callable from **either** `PtAuthGuard` (restricted to the caller's own
  `staffAccountId` — a PT can only ever query their own linked
  relationships) **or** `AdminAuthGuard` (no `staffAccountId` restriction —
  any relationship, any PT). This is argued the same way ADR-0022 Decision
  2 argued the admin account's own legitimacy: **the project owner already
  holds unrestricted Postgres access to this exact data** (the same
  residual ADR-0020/0022 already name), so admin's ability to read any
  already-**consented** PT-player relationship through this new UI is
  strictly more convenient/auditable access to something already
  reachable, not a new capability. **What admin's "access to everything"
  does *not* mean**: admin cannot see a player's data through this path
  that no PT relationship has ever been consented for — the PT-consent
  gate (Decision A3) still has to have actually fired for that specific
  child; admin is not a backdoor around Decision A3, it's an oversight
  view onto whatever Decision A3 has already produced, exactly mirroring
  the "a bug report only ever shows what a child voluntarily submitted"
  shape of bounded exception ADR-0022 Decision 5 already accepted for
  `BugReport`.
- **Neither role ever gains access to the other two ADR-0022 pillars this
  ADR doesn't touch**: `pt` role has zero access to `ErrorLogEntry`,
  `BugReport`, or the planning/roadmap views — those stay exactly as
  ADR-0022 Decisions 6/7/10 designed them, `admin`-only, unrelated to
  anything in this ADR.

### Decision — B5: human/bot verification — delegate to the SSO providers, don't add a redundant CAPTCHA; a plain rate limit on the callback route is the actual, boring mitigation for the one local surface that remains

The project owner asked for CAPTCHA-style verification on PT/admin
signup+login specifically. **Decision, argued rather than built on
request alone, per the task's own instruction to decide, not assume**:
**do not add a third-party CAPTCHA widget for this feature.**

- **There is no local account-creation or login form to protect in the
  first place.** Every account in this system is 100% provisioned via an
  OAuth callback carrying a provider-verified identity token — this app
  never renders a signup/login form, never accepts a password, and never
  has a local brute-force/credential-stuffing surface to defend (unlike
  ADR-0022's original password-based design, which legitimately needed
  its own rate limiter for exactly that reason). A bot attempting to
  "sign up" here would have to actually control a real Google/Microsoft/
  Apple account for every attempt — each of those providers already
  operates extensive, continuously-updated bot/fraud defenses (device
  attestation, phone verification, rate limiting, anomaly detection) on
  their **own** account-creation and login surfaces, which is exactly what
  the project owner's own stated reasoning for choosing SSO in the first
  place ("rely on their security and not create our own") already argues
  for, one level further than the password-vs-MFA question it was
  originally asked about. Building a redundant local CAPTCHA in front of a
  flow that never collects the thing CAPTCHA protects (a spammable form)
  is defending against a threat that doesn't exist in this design's shape.
  **Tied explicitly to Part A's own design, per security-reviewer's Part B
  pass (Finding 4, see Status)**: even in the hypothetical worst case
  where a bot did somehow acquire and drive a real Google/Microsoft/Apple
  account through this flow, the resulting `StaffAccount` row is, by
  Decision A1/B1's own explicit design, a `pt`-role account with **zero**
  linked players or teams and zero standing capability to view anything —
  there is no incremental harm on the other side of a successful bot
  signup here, unlike a form that gates a real capability a bot
  registration would then hold.
- **The one real local surface — our own `/api/v1/staff-auth/:provider/
  callback` and `/login` (initiate) routes being hit directly with junk
  requests — is a plain volumetric/DoS concern, not a bot-signup
  concern, and gets this codebase's existing, boring answer**: a per-IP
  `@Throttle` rate limit on both routes, the same `ThrottlerGuard` pattern
  already used on `ConsentController`/onboarding/session-reissue. No new
  dependency, no new pattern.
- **Self-hosted-vs-third-party framework, applied for completeness even
  though the recommendation is "build nothing"**: if the project owner
  still wants a visible CAPTCHA widget for reasons beyond this technical
  threat model (e.g. optics, a specific compliance ask), this codebase's
  own established instinct (ADR-0010/0018/0020/0022 Decision 6) would
  recommend a well-known third-party widget (e.g. Cloudflare Turnstile)
  over self-hosting one — and the task's own framing is correct that this
  is materially lower-stakes here than the same question would be on a
  child-facing page (no child ever sees or interacts with this surface at
  all; players are explicitly out of scope for this entire ADR). Named
  explicitly as an available, reasoned option, not silently adopted —
  this ADR's actual recommendation remains "build nothing," per the
  argument above.

### Decision — B6: new `backend/` dependencies — one generic OIDC client library, not three separate Passport strategies; new per-environment `Secret` entries; redirect URIs reuse `APP_PUBLIC_URL`

**Recommend a single, generic OIDC client library (`openid-client`) used
three times (one configured instance per provider), rather than three
separate Passport strategy packages** (`passport-google-oauth20`,
some Microsoft/Entra-specific package, `passport-apple`). Argued: all
three providers are standards-compliant OIDC providers — a single,
well-maintained generic client gives one uniform code path
(`OidcProviderService`, parameterized per provider's discovery
document/client credentials, one shared callback-handling shape) rather
than three differently-shaped, differently-maintained Passport
integrations each with their own quirks (Apple in particular has no
first-party, actively-maintained Passport strategy at the same quality
bar as Google's). This is the "boring, uniform" choice consistent with
ADR-0004 Part 2's own preference for small, explicit code over framework
machinery — not a hard block on Passport if backend-developer has a strong
ecosystem-convention reason to prefer it; either is acceptable, this is a
recommendation with reasoning, not a mandate.

**Required, explicit, not left implicit — added per security-reviewer's
Part B pass (Finding 3, see Status)**: whichever library implements the
three OIDC integrations, the standard `state` (login-CSRF protection),
PKCE (`code_verifier`/`code_challenge`), and `nonce`
(authorization-code-injection/replay protection) parameters must be
generated, held server-side tied to the pre-authentication request (e.g. a
short-lived signed cookie or session value), and verified on callback, for
all three providers — the standard defense against login-CSRF and
authorization-code-injection on any OAuth/OIDC authorization-code flow.
This is very likely satisfied automatically by `openid-client`'s own
`authorizationUrl()`/`callback()` helpers when used as intended (the
library is built around the standards-compliant flow, not a bare HTTP
client), but the original draft never said so explicitly — backend-
developer must confirm this during implementation (e.g. a test asserting
a callback with a missing or mismatched `state`/`nonce` is rejected)
rather than assume the library's defaults are wired in correctly by
construction.

**New `Secret` entries** (per-environment, following `k8s/secret.yaml.
example`'s existing pattern exactly, one GitHub Actions secret per key):

- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`
- `MICROSOFT_OAUTH_CLIENT_ID` / `MICROSOFT_OAUTH_CLIENT_SECRET`
- `APPLE_OAUTH_CLIENT_ID` (Apple's "Services ID"), `APPLE_TEAM_ID`,
  `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` — **named explicitly as a different
  shape from the other two providers**: Apple's "client secret" is not a
  static string, it's a JWT this app must generate itself, signed with an
  Apple-issued private key, valid for at most 6 months per Apple's own
  rule — a genuinely different, periodic manual-regeneration operational
  task, the same *kind* of cadence this app already accepts for
  `JWT_SECRET`/`PII_ENCRYPTION_KEY` rotation, but on a fixed forced
  schedule rather than an as-needed one. Flagged here so it isn't
  discovered live when Apple sign-in silently starts failing six months
  after launch — not designed further than naming it (automating the
  regeneration is a plausible, small, additive follow-up, not required
  for v1).
- `ADMIN_EMAILS` (Decision B1), `STAFF_JWT_SECRET` (Decision B2, replacing
  `ADMIN_JWT_SECRET`).
- `STAFF_COOKIE_SECURE` (`ConfigMap`, non-secret, replacing
  `ADMIN_COOKIE_SECURE`).

**Redirect URIs reuse the existing `APP_PUBLIC_URL` `ConfigMap` value**
(already `https://api.skillstreak.xyz` in production) plus a fixed path
(`/api/v1/staff-auth/:provider/callback`) — no new URL config value is
introduced, the same "reuse what exists" instinct ADR-0022 Decision 3
already applied to its own admin surface's same-origin fetch reasoning.
Each provider's own developer console still needs the resulting exact URL
registered by hand, per environment, per provider (three redirect URIs
total for production; `ubuntu01` registers none, per Decision B3).

## Part A — the PT (Personal Trainer) role

### Decision — A1: does a PT reintroduce Phase 2's rejected risk shape — argued point by point, not assumed either way

**Phase 2's actual objection, restated precisely because everything below
answers it directly**: not "an adult account is unsafe," but **a new
class of standing, extensible adult authority over specific children's
specific data/accounts** — a coach could gain more teams, more rosters,
challenge-authoring power, and the power to trigger a specific kid's
session reissue, all via one `TeamCoach` membership grant with no
per-child opt-out anywhere in the design.

**A PT role, as designed below, is a new class of adult presence in this
app — genuinely, this ADR does not pretend otherwise — but it is bounded
along every axis that made the original design unacceptable:**

1. **Zero write authority over any player state, ever.** The original
   coach design was headed toward roster CRUD, challenge-authoring, and
   triggering a teammate's session reissue — real *actions* over a child's
   account. A PT, in this design, has **no** write path to anything a
   player owns: no challenge creation, no session-reissue trigger, no
   roster edit, no chat participation, no moderation authority. The PT
   surface (Decision A5) is **read-only**, full stop — a materially
   smaller category of risk than "an adult who can act on a child's
   account," which this ADR never builds.
2. **Per-relationship, not per-team-membership, and never granted by a
   captain alone.** The original design's `TeamCoach` row was an
   all-or-nothing grant to an entire roster, with no individual family
   able to carve their own child out of it. Here, a team's captain can
   only create the **team-level link** (Decision A2) — which by itself
   grants **zero player data visibility** — every individual child's data
   additionally requires that specific child's own family (or the child
   themself, for the 13+ self-verification cohort) to separately approve
   a **specific, named PT** (Decision A3). No captain action, on its own,
   ever exposes a teammate's data to anyone.
3. **Immediately, unilaterally revocable by three independent parties**
   (Decision A4) — the child themself, their parent, or the team — none of
   which the original coach design gave any lever to at all (a family had
   no way to end a coach's access to their specific child without the
   coach/admin acting first).
4. **A fixed, allow-listed, read-only data shape** (Decision A5) that
   structurally excludes chat, video, and every `PlayerPrivateInfo` field
   — the original design had no equivalent ceiling; a coach's roster view
   was headed toward full account visibility.
5. **Cannot grow into more per-player training-data access without a
   fresh, explicit action for each new relationship** — there is no "add
   another team" or "add another player" button that grants visibility
   into a specific child's training history without re-running Decision
   A3's per-relationship consent chain from scratch. The original design's
   core failure mode (access silently expanding as more `TeamCoach` rows
   get added with no per-child check) structurally cannot happen for
   **that** tier.
   **Correction, folded in per security-reviewer's Part A pass (Finding 5,
   documented in full in Status)**: as originally written, this point
   overclaimed — true for the per-player training-data tier, but not, as
   stated, for the team-aggregate tier (screen name + PT-consent status).
   A child who joins a team **after** that team already has an active
   `PtTeamLink` becomes visible in that tier automatically, to that PT, the
   moment they join — no captain action, no family action, no
   acknowledgment of any kind by anyone. **Decided explicitly, not left
   ambiguous**: this is accepted as the intended design for the
   team-aggregate tier specifically — see Decision A5's team-aggregate
   table and Decision A6's own residual for the full argument (screen name
   plus a none/pending/approved consent-status flag is no more exposing
   than what every existing teammate's own roster view already shows a new
   joiner's teammates, and holding a new joiner back from it would defeat
   the team-aggregate tier's stated purpose — letting a linked PT see who
   exists to ask — for a marginal reduction in an already low-sensitivity
   field). What genuinely **cannot** happen without a fresh, explicit,
   per-child action, for any child regardless of when they joined their
   team, is the **per-player training-data tier** — that consent chain
   (Decision A3) always runs from scratch, for every player, with no
   shortcut, no exception, and no effect from team roster changes. This
   point's original blanket "structurally cannot happen here" language is
   corrected to scope explicitly to that tier only.

**Conclusion**: this is not the same unbounded thing Phase 2 rejected, but
it is close enough in *kind* (a real, standing, potentially cross-team
adult presence with legitimate visibility into specific children's
behavioral data) that it earns the same weight of review Phase 2's pivot
itself got, and the same weight ADR-0019 got for its own comparable
"new adult/audience authority" question — stated in Status, not asserted
here as already settled.

### Decision — A2: how a PT gets linked — a two-step chain, team-level link then per-player consent, never one action granting both

**Step 1 — team-level link, captain-initiated, grants nothing by
itself.** A team's captain (reusing `PlayersService.assertIsCaptainOfTeam`,
the exact existing service-layer check, no new guard class) generates a
short, human-shareable, time-boxed invite code —
`POST /api/v1/teams/:teamId/pt-links/invite` → `{ code, expiresAt }` —
structurally identical in shape to the existing `Team.invite_code`/session-
reissue-code pattern (`generateHumanCode`, an 8-character code from a
visually-unambiguous alphabet, short TTL, e.g. 24 hours, single-use). An
already-SSO-authenticated `pt`-role `StaffAccount` redeems it:
`POST /api/v1/pt/team-links/redeem { code }`, creating a `PtTeamLink` row.

```
PtTeamLink
  id                     uuid, PK
  team_id                uuid, FK -> team.id, ON DELETE CASCADE
  pt_staff_account_id    uuid, FK -> staff_account.id, ON DELETE CASCADE
  invited_by_player_id   uuid, FK -> player.id, ON DELETE SET NULL
                            -- the captain who generated the invite code —
                               kept for audit ("who brought this PT in"),
                               nulled (not cascaded) if that player later
                               erases their own account, since the link
                               itself should outlive the specific captain's
                               tenure the same way a Challenge's authorship
                               record does today
  status                 enum('active', 'revoked'), not null, default 'active'
  created_at             timestamptz, not null
  revoked_at             timestamptz, nullable
  UNIQUE (team_id, pt_staff_account_id) WHERE status = 'active'
    -- one active link per (team, PT) pair — re-inviting after a revoke
    -- creates a new row, preserving the old one as history, the same
    -- "history stays, only one row is ever active" shape ADR-0019's
    -- ClipPublicationRequest already established
```

**On its own, an active `PtTeamLink` exposes exactly two things, both
already visible to every member of that team and neither identifying any
individual child's private status**: the team's name/current
`TeamSeasonPot` totals and active weekly-goal progress (Decision A5's
team-aggregate tier), and the roster's **screen names** plus each
player's current PT-consent status (`none`/`pending_review`/`approved`) —
so a PT can see *who exists to ask*, never their training data, until step
2 clears for that specific child.

**Step 2 — per-player consent, PT-initiated, family (or self)-approved.**
An already-team-linked PT requests visibility into one specific player:
`POST /api/v1/pt/players/:playerId/consent-requests` (requires an active
`PtTeamLink` between this PT and that player's `team_id` — `403
no_active_team_link` otherwise; a PT cannot request a player on a team it
has no active link to, closing the "PT scans for random players across the
whole app" concern outright at the authorization layer, not just by
convention). Full mechanism in Decision A3.

### Decision — A3: the per-relationship consent gate — a new, materially stronger step than the account-level toggle, reusing ADR-0019's mailed review-and-approve pattern, not the account-level gate

**Decision: the existing account-level `parentalConsentStatus` gate is
insufficient on its own, and this ADR does not reuse it as the PT gate —
argued, not asserted.** The account-level consent copy
(`backend/src/consent/consent-page.templates.ts`) was drafted, and every
existing family's approval was given, anticipating "team training-log
tracking, team chat, and (per-item) media upload" — it says nothing about,
and no reasonable parent reading it would anticipate, **a specific
named third-party adult, plausibly unaffiliated with the team's own
roster of coaches, being able to view their child's individual training
history.** This is the same "informed consent means naming what's actually
new" standard `docs/adr/0018-ai-video-content-tagging.md` Decision 3
already applied to a smaller, passive, internal processing step — a PT
relationship is a bigger step than that (a live, standing, external human
viewer, not an internal derived-data process), closer in shape to the
**audience-widening** move `docs/adr/0019-public-shorts-feed.md` Decision
1 required a fresh, specific, evidence-based approval for, not merely a
disclosure line. **This ADR adopts ADR-0019's bar, not ADR-0018's.**

**Mechanism — reuses ADR-0019 Decision 1's `ClipPublicationRequest`
pattern structurally, adapted for a non-media approval:**

```
PtPlayerConsent
  id                            uuid, PK
  pt_team_link_id               uuid, FK -> pt_team_link.id, ON DELETE CASCADE
                                   -- every per-player consent must trace
                                      back to an active team link at the
                                      moment it was requested — see
                                      Decision A4 for why this is what
                                      makes team-level revocation cascade
                                      correctly
  pt_staff_account_id           uuid, FK -> staff_account.id, ON DELETE CASCADE
                                   -- denormalized from pt_team_link, query
                                      convenience only, same
                                      TrainingLogEntry.team_id-style pattern
                                      ADR-0002 already establishes
  player_id                     uuid, FK -> player.id, ON DELETE CASCADE
  status                        enum: pending_review / approved / declined /
                                       revoked / expired
  review_code                   varchar, nullable, unique
                                   -- generateHumanCode, the same utility
                                      every mailed-code flow in this app
                                      already reuses
  review_code_expires_at        timestamptz, nullable
                                   -- recommend 7 days, matching
                                      ClipPublicationRequest's own reasoning
                                      ("a genuinely bigger single-sitting
                                      ask than a 15min/24h code") — deciding
                                      whether to let a specific adult see
                                      your child's training history is at
                                      least as weighty a read as watching a
                                      clip before approving it
  revoke_code                   varchar, nullable, unique
                                   -- separate from review_code, minted at
                                      approval time, deliberately NON-
                                      expiring (see Decision A4 — revocation
                                      must always be available, unlike
                                      granting, which needs a freshness
                                      window)
  recipient_contact_snapshot    varchar, nullable, encrypted (AES-256-GCM,
                                   ADR-0011's existing utility) — the exact
                                   contact-change-hijack-race fix from
                                   ADR-0013 Decision 2 / ADR-0019, reused
                                   verbatim: PtPlayerConsentService checks
                                   PlayerPrivateInfoService
                                   .hasPendingContactChange(playerId) before
                                   creating this row (409
                                   pt_consent_blocked_pending_contact_change
                                   if one is in flight), calls
                                   getParentContact() exactly once, and
                                   snapshots the resolved value here —
                                   never re-resolved for this request's
                                   lifetime
  decided_at                    timestamptz, nullable
  revoked_at                    timestamptz, nullable
  revoked_reason                enum, nullable: parent_or_player_revoked /
                                       team_link_revoked / account_erasure
  created_at                    timestamptz, not null
  -- partial unique index: one active (pending_review/approved) row per
  -- (pt_staff_account_id, player_id), identical mechanism to
  -- ClipPublicationRequest's own single-active-row invariant
```

**The 13+ self-verification cohort — same mechanism, same open flag
ADR-0019 already raised, not re-litigated as if it were a fresh
question**: for players whose `parent_contact` holds their own verified
email (ADR-0002's 2026-07-27 addendum), the identical review-and-approve
email goes to that same address — reusing `isSelfVerificationAge`'s
existing age-band branching, no new special-casing. **Flagged explicitly,
not decided silently**: whether Sweden's GDPR Art. 8 self-consent floor
extends to *"a 13+ player consenting, with no parent in the loop at all,
to a specific third-party adult gaining standing visibility into their own
training data"* is the same underlying legal question ADR-0019 Decision 1
already flagged as open for a different processing purpose (approving
one's own video for a wider audience) — **this ADR does not answer it
either, and recommends the project owner seek one real legal read that
covers both open self-approval questions together**, since they're the
same Art. 8 boundary question asked twice, not two separate ones. The
mechanism above is a default built to be easy to tighten (e.g. requiring a
different check for this cohort specifically) without a schema change, the
same "policy/routing change, not a schema change" property ADR-0019
already built in.

**Approval-email content — described explicitly, since this is the actual
informed-consent moment**: names the specific PT (their display name +
email, from the SSO identity — this app performs no independent identity
verification of a PT beyond what the SSO provider itself already
establishes, and this is argued as sufficient below), and states plainly,
in the same allow-listed terms as Decision A5, exactly what becomes
visible if approved (screen name, streak/training-log history, badges) and
what never does (real name, chat, video, any other child's data). **No
advance disclosure line is added to the existing account-level consent
copy for this feature** — unlike ADR-0022 Decision 8's bug-report
disclosure (added there because that feature has no per-instance approval
event of its own to carry the disclosure), every actual PT-visibility
grant already comes with its own fresh, specific, described approval email
at the moment it's requested; adding an advance line to the account-level
copy would only pre-announce, in vaguer terms, what the per-relationship
email must already say in full.

**Why no independent PT-identity verification beyond SSO is designed
here**: the family (or self-verifying player) making the approval decision
is shown exactly who is asking (a real name and email address the SSO
provider itself already vouches for) — the actual trust judgment ("do I
believe this specific person should see my child's training numbers") is
made by a human who knows their own child's actual situation, the same way
a family already vets a real-world personal trainer today. This app is
facilitating an identity-disclosed introduction, not independently
credentialing PTs (background checks, certifications) — that's a real,
separate, business/legal-judgment question (does SkillStreak want to
vouch for a PT's qualifications at all, and if so, how) explicitly **not**
decided here, flagged as a plausible future item if the paid-plan business
model (out of scope, per Context) ever makes it relevant.

**Endpoints**:

```
POST /api/v1/pt/players/:playerId/consent-requests
  -- PT-authenticated (PtAuthGuard). Requires an active PtTeamLink to the
     player's team; refuses 409 if an active PtPlayerConsent already
     exists for this (pt, player) pair; refuses 409
     pt_consent_blocked_pending_contact_change per above. Rate-limited
     (burst + daily cap per PT, reusing RedisService's existing
     tryClaim.../session-reissue-shaped pattern) — the realistic abuse
     surface is a bad-faith or compromised PT account mass-requesting
     many families' inboxes, structurally the same shape as the
     session-reissue harassment finding ADR-0004's addendum already found
     and fixed, applied preemptively here rather than found live.
     Recommended additional guardrail, given a PT's cross-team reach makes
     a single compromised account higher-leverage than an ordinary
     player's: a global cap on how many *pending* (not yet decided)
     requests one PT account may have open at once — a tunable config
     value, not fixed here, same "left open, not a schema decision"
     posture ADR-0010's numeric caps already have.

GET /api/v1/pt/players/:playerId/consent-status  -- PT-authenticated
  (PtAuthGuard). **Requires the identical active-`PtTeamLink`-to-that-
  player's-team check as the sibling write endpoint above — added
  explicitly per security-reviewer's Part A pass (Finding 6, see Status)**,
  since the original draft stated this guard only on
  `POST .../consent-requests` and left this read endpoint's authorization
  implicit. Without it, a `pt`-role account with zero active team links
  could probe/enumerate consent-status for arbitrary player IDs app-wide
  (learning `none`/`pending_review`/`approved` for any child, regardless of
  any relationship to that child's team); refuses `403 no_active_team_link`
  otherwise, identical to the write endpoint's own refusal.

GET  /api/v1/pt-consent/:reviewCode        -- unauthenticated preview,
POST /api/v1/pt-consent/:reviewCode/approve -- no side effects on GET,
POST /api/v1/pt-consent/:reviewCode/decline    same GET-preview/POST-action
                                                 split as every other
                                                 mailed-link flow in this
                                                 app, throttled per-IP
```

### Decision — A4: revocability — three independent, immediate, unconditional levers, mirroring this app's existing self-determination posture

Per this project's own established practice (ADR-0010's self-delete,
ADR-0013's self-erasure, ADR-0006's self-service captain transfer — every
one of them "immediate and unconditional, no exceptions, no waiting on
anyone else"), a PT relationship must be endable **immediately** by any of
three parties, none of which needs any other party's cooperation:

1. **The player themself, in-app, self-service** —
   `POST /api/v1/players/me/pt-consents/:id/revoke` (authenticated,
   `JwtAuthGuard`, ownership-checked). A child can end a specific PT's
   visibility into their own data at any time, no parent action required —
   consistent with this app's repeated "a child has real self-determination
   over their own account" stance, and a strictly *lower*-friction action
   than the *granting* step required (asymmetric on purpose: granting new
   third-party visibility gets the stronger gate; ending it gets none,
   mirroring `unpublish`'s asymmetry in ADR-0019 Decision 1).
2. **The parent (or the 13+ self-verified player's own inbox), via the
   non-expiring `revoke_code`** mailed alongside the original approval
   confirmation — `GET/POST /api/v1/pt-consent-revoke/:revokeCode`,
   unauthenticated, same GET-preview/POST-action split as every other
   mailed-link action in this app. Deliberately **never expires**, unlike
   the granting code: a parent should always be able to act on this, not
   only within a freshness window meant to protect the *decision to grant*
   from being stale.
3. **The team, via revoking the whole `PtTeamLink`** —
   `POST /api/v1/teams/:teamId/pt-links/:id/revoke` (captain-authenticated,
   `assertIsCaptainOfTeam`). **Cascades, in one transaction, to
   `status = 'revoked', revoked_reason = 'team_link_revoked'` on every
   currently-`approved`/`pending_review` `PtPlayerConsent` row whose
   `pt_team_link_id` points at it** — this is exactly why Decision A3's
   schema roots every per-player consent to the team link it was requested
   under: a team can eject a PT from its own roster's visibility entirely,
   at once, without needing to track down and act through each individual
   family. This gives the team a circuit breaker independent of any single
   family's own action, the same "team-level self-determination" shape
   `docs/adr/0009-self-service-team-creation.md`'s general posture already
   normalizes for this app.

**Every read endpoint in Decision A5 re-checks live status at request
time, never trusts a cached grant** — the identical "never trust a stored
bookmark/decision alone, always re-derive current state" bar ADR-0019
Decision 6 already set for `SavedClip`. A revoked relationship stops
returning data on the very next request, with no propagation delay of any
kind (unlike Decision B1's role-staleness, which is a session-lifetime
bound by design — this is a live per-request check, not session-bound).

### Decision — A5: the data allow-list — fixed, argued field by field, split into a team-aggregate tier (gated on `PtTeamLink` alone) and a per-player tier (gated on `PtPlayerConsent = approved`)

Same "fixed, allow-listed, argued not assumed" discipline this codebase
already applies to `BadgeAward.context` (ADR-0002 addendum §3), the tag
vocabulary (ADR-0018), the usage-metrics query set (ADR-0020), and
`BugReport`'s capture allow-list (ADR-0022 Decision 7) — a PT's `GET`
response types have no field, anywhere, outside this list, and adding one
later is a small, reviewable, explicit diff, never an incidental side
effect of wiring up a UI element.

**Team-aggregate tier — visible once `PtTeamLink.status = 'active'`, no
per-player consent needed, because none of it identifies or exposes an
individual child beyond what any teammate viewing their own roster already
sees**:

| Field | Included? | Why |
|---|---|---|
| `team.name` | Yes | Already cross-team-visible via the leaderboard (ADR-0008) — no stricter here. |
| `TeamSeasonPot.pointsTotal`/`goalThreshold` | Yes | Same reasoning — an aggregate, non-attributable running total. |
| Active weekly goal + team-wide progress | Yes | Team-wide by construction (ADR-0005 Decision 2) — never attributable to one player. |
| Roster `screenName` list | Yes | Already visible to every teammate; not new exposure to a PT who the team itself has already linked. |
| Per-roster-row PT-consent status (`none`/`pending_review`/`approved`) | Yes | Needed so the PT knows who they may request, not a leak of any player's private data. |
| Roster size (exact) | Yes | The PT already sees the full screen-name list above; a bucketed count (ADR-0016's leaderboard treatment) exists specifically to protect *cross-team* comparisons — this is a same-team relationship the team itself created, not a cross-team leaderboard read. |

**Per-player tier — visible only once `PtPlayerConsent.status =
'approved'` for that exact `(pt, player)` pair**:

| Field | Included? | Why |
|---|---|---|
| `screenName` | Yes | Already visible via the team-aggregate tier above. |
| `currentStreakCount`/`longestStreakCount`/`lastTrainedDate` | Yes | This is the literal "track their numbers" ask — the individual-streak data, never the team-pool numbers (already covered above and not per-child anyway). |
| `TrainingLogEntry` history (`loggedAt`, `activityType`, `durationMinutes`) | Yes | Same reasoning — the actual training log a PT needs to do their job; no free-text field exists on this entity to leak anything beyond it. |
| `BadgeAward` list — `badge.key`/`displayName`, `awardedAt`, **and nothing else from this entity** | Yes | The field list is deliberately just those three. Wording tightened per security-reviewer's Part A pass (Finding 7, see Status): **`BadgeAward.context` — including its freeform, coach-authored `note` subfield (`backend/src/badges/dto/badge-award-context.dto.ts`) — is explicitly excluded, not included-but-assumed-safe.** `context` can carry a coach's own freeform text about a specific award and has never been part of this allow-list; a PT's `GET` response includes only `badge.key`/`displayName`/`awardedAt`, full stop. |
| `birthYear` | **Left open, not decided here** | Plausibly useful for age-appropriate session design (already a lower-sensitivity, operationally-reused field per ADR-0002's original reasoning), but not explicitly asked for by "track their numbers" — flagged for ux-designer/project-owner to confirm as a small, additive follow-up rather than included by default, matching this ADR's own "argue each field" discipline rather than including it because it's convenient. |
| `PlayerPrivateInfo.real_name`/`parent_contact` | **Never** | CLAUDE.md's anonymization option exists specifically so a screen name can stand in for a real identity — a PT is exactly the kind of external party that option protects against, not an exception to it. |
| `TeamChatMessage` (any) | **Never** | Named explicitly in the task; chat is a closed-team-bubble surface with its own moderation model (ADR-0007) that assumes only teammates and never any PT are present. |
| `VideoClip` (any, team or public) | **Never** | Named explicitly in the task, even though a future points-tier idea (`docs/BACKLOG.md`) imagines PT-relevant video sharing — that is explicitly not this ADR's scope (Context) and is not built as a side effect here. |
| Any other PT's linked players/teams, or that a given player has *other* PT relationships at all | **Never** | Not asked for, and a real, avoidable cross-PT information leak (a PT learning "this kid also works with another trainer") that this design has no reason to expose. |
| Location, device ID, IP | **Never** | CLAUDE.md's non-negotiable — restated here even though nothing in this data model has ever carried these fields, matching this codebase's practice of naming the exclusion explicitly rather than relying on "it was never there anyway." |

**Structural enforcement, not just an intended API shape**: `PtDataService`
method signatures require an explicit, verified `(ptStaffAccountId,
playerId)` or `(ptStaffAccountId, teamId)` pair and internally re-check the
live relationship status before querying — there is no method on this
service that returns player data without that check, the same "no
`teamId`/`playerId` field with nothing to wire a filter to" structural bar
ADR-0022 Decision 5 already set, applied in the opposite direction here
(this pipeline's whole job *is* per-player data, so its floor is "cannot
run without a verified live consent row," not "cannot express per-player
data at all").

### Decision — A6: cross-team reach — bounded by explicit per-child, per-relationship consent; compatible with the closed-team-bubble constraint's spirit, argued the way ADR-0019 had to argue its own crack

CLAUDE.md's closed-team-bubble constraint: *"no data/video/comments public
by default; a user only ever sees their own verified team."* **This
constraint is about player-to-player visibility across teams, and about
nothing defaulting to broader visibility** — restated because it's the
exact question this Decision has to answer, not assumed either way.

**Does a cross-team-capable PT violate it? Argued, not assumed, the same
way ADR-0019 Decision 2/3 had to argue its own first-ever cross-team
video-visibility crack was compatible with the same constraint's spirit:**

- **No player ever gains visibility into another team's players, chat, or
  video through this feature, at all.** A PT is not a player, has no
  "team" of their own in the schema's sense, and every read endpoint
  (Decision A5) is scoped to exactly one `(pt, player)` or `(pt, team)`
  relationship at a time — nothing here creates or widens any
  player-to-player visibility path. The literal mechanism this constraint
  polices (a child seeing another child's team's data) is untouched.
- **Nothing defaults to broader visibility — every single grant is an
  explicit, affirmative, per-child (or per-team, for the aggregate tier)
  action**, never an ambient default the way "public" would be. This is
  the identical bar ADR-0019 Decision 2 already applied when scoping its
  own public feed ("app-wide, never outside the app... every public-feed
  read still re-checks current approval status").
- **A PT's audience, per relationship, is exactly one specific adult the
  family or team has already, explicitly identified and vetted** — this
  is categorically narrower than ADR-0019's own crack, which opens a
  clip to *every other authenticated player in the entire app*, a
  materially larger and more anonymous audience than "one named adult my
  own family said yes to." If ADR-0019's own review concluded that crack
  was compatible with this constraint's spirit (subject to its own
  per-clip consent gate, anonymization, and revocability), a PT
  relationship — narrower in audience, narrower in data, revocable by
  three parties instead of the uploader alone — clears the same bar a
  fortiori, not by a lower standard.
- **The real-world analogy is load-bearing, not decorative**: families
  routinely already grant an external, cross-club personal trainer
  visibility into their child's training in the physical world (a shared
  training log, a text thread, a shared spreadsheet) — this feature
  represents and bounds an already-normal real-world relationship inside
  the app's own consent/audit machinery, rather than inventing cross-team
  child-to-child contact that has no such precedent, which is the actual
  category of harm the closed-bubble constraint was written to prevent
  (per CLAUDE.md's own framing: "flag and push back on... adding
  geolocation for 'nearby teams'" — i.e., the constraint's target is
  discoverability/contact between children/teams that didn't already
  know each other, not a family's own chosen adult).

**Residual, stated plainly, matching this project's own honesty
standard**: nothing prevents a PT who is linked to many teams from, over
time, building a genuine cross-team picture of "which teams/players exist
and who has and hasn't approved me" (the team-aggregate tier's roster
screen-name list) even for children whose families never individually
approve anything further. This is a real, bounded exposure — screen names
and consent-status, never training data or any other private field — and
is the direct, necessary cost of a team being able to see who it invited
before any family decides anything, the same trade ADR-0019 Decision 3
accepted for its own public-feed anonymization residual ("this ADR
structurally prevents the app itself from handing out more, it cannot
prevent every possible inference"). Not eliminated further here because
doing so (e.g. hiding the roster from a linked PT entirely) would defeat
the team-level link's own stated purpose (letting a captain-invited PT see
who to ask) for a marginal reduction in an already-low-sensitivity field.
**This is the same residual Decision A1 point 5 is corrected to name
explicitly, not a separate concession** — see the correction there
(security-reviewer's Part A pass, Finding 5).

### Decision — A7: PT onboarding/account creation — folded entirely into Part B's `StaffAccount`, no separate account type

**Yes, a PT needs an onboarding flow distinct from a player's — designed
at the data-model level here, full UX explicitly left to ux-designer, per
the task's own framing.** A PT account is a `StaffAccount` row with
`role = 'pt'` (Decision B1), provisioned automatically on first SSO
login, with **zero** linked players or teams until Decision A2's chain
runs. No age-band branching, no `PlayerPrivateInfo`-style split table, no
consent flow of its own at the *account* level — those are all specific,
argued answers to "this is a child," none of which apply to an adult
professional's own account. The only PT-specific data this ADR captures
beyond `StaffAccount`'s existing columns (email, display name, both from
the SSO identity) is the relationship rows themselves (`PtTeamLink`,
`PtPlayerConsent`) — there is no separate `PtProfile` entity, and adding
one (e.g. a bio, credentials, a photo, to help a family decide whether to
trust a specific PT) is a plausible, small, additive future
ux-designer-driven change, not built here on spec.

**PT (or admin) self-service account deletion is explicitly out of scope
for this ADR** — not because it's unimportant, but because it's a
different, adult-data-subject-rights question from the child-focused GDPR
erasure feature this app already built (ADR-0013), with different
expectations and no urgency established yet. The schema already supports
a manual, operational deletion of a `StaffAccount` row cleanly regardless
of how that ever gets triggered (`PtTeamLink`/`PtPlayerConsent` both
`ON DELETE CASCADE` from `staff_account_id`) — a future, small ADR if/when
this becomes a real request, not designed further here.

## Interaction with `docs/adr/0013-account-erasure.md`

Every new table in this ADR cascades cleanly from an existing erasure
path, the same "free cleanup, zero new per-entity treatment" property
ADR-0019 already demonstrated for its own three new tables:

- **A player erases their own account.** `PtPlayerConsent.player_id` is
  `ON DELETE CASCADE` — every PT relationship about that specific child
  disappears with the rest of their data, automatically, no new code path.
- **The last player on a team erases their account and the team itself is
  deleted** (ADR-0013 Decision 5's existing cascading-team-delete case).
  `PtTeamLink.team_id` is `ON DELETE CASCADE`, taking every
  `PtPlayerConsent` rooted under it along via its own `pt_team_link_id`
  cascade — a defunct team's PT relationships don't linger.
- **The captain who generated a PT invite erases their account.**
  `PtTeamLink.invited_by_player_id` is `ON DELETE SET NULL` (not cascaded)
  — the link and every consent under it survive that one player's own
  erasure, the same "the audit trail of who authored something survives
  the author's own departure" reasoning `Challenge.created_by_player_id`
  already established (`ON DELETE RESTRICT` there; `SET NULL` here is
  slightly different but the same underlying instinct — a captain leaving
  shouldn't retroactively unwind a PT relationship the rest of the team
  and specific consenting families still rely on).

**No new row is needed in ADR-0013 Decision 6's per-entity table** — both
new tables are additive, both cascade from existing FKs, exactly the
property ADR-0019 already achieved twice.

## Consequences

- **New tables**: `StaffAccount`, `PtTeamLink`, `PtPlayerConsent`. No
  changes to any existing table (`Player`, `Team`, `TrainingLogEntry`,
  `BadgeAward` are all read-only inputs to Decision A5's queries, never
  modified).
- **Superseded**: ADR-0022 Decision 2 (single hardcoded admin credential,
  bcrypt, `ADMIN_JWT_SECRET`) — replaced by Decisions B1/B2 above.
  **`bcrypt` is dropped as a `backend/` dependency** (nothing in this
  design hashes a password — the only two candidate uses this app has ever
  named for it, ADR-0004 Part 1's original coach login and ADR-0022
  Decision 2's admin login, are both now superseded).
- **New `backend/` dependency**: an OIDC client library (`openid-client`
  recommended, Decision B6) — genuinely new integration surface (three
  provider configurations), not a small addition.
- **New config**: `ADMIN_EMAILS`, `STAFF_JWT_SECRET` (replacing
  `ADMIN_JWT_SECRET`), `STAFF_COOKIE_SECURE` (replacing
  `ADMIN_COOKIE_SECURE`), `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET`,
  `MICROSOFT_OAUTH_CLIENT_ID`/`_SECRET`, `APPLE_OAUTH_CLIENT_ID`/
  `APPLE_TEAM_ID`/`APPLE_KEY_ID`/`APPLE_PRIVATE_KEY` — all `Secret`
  entries, per-environment, `.example`-templated, never hardcoded.
- **New modules** (backend-developer's exact wiring, not fixed here):
  `staff-auth/` (OIDC callback handling, `StaffAccount` provisioning/role
  derivation, `StaffAuthGuard`/`AdminAuthGuard`/`PtAuthGuard`), `pt/` (owns
  `PtTeamLink`, `PtPlayerConsent`, the invite/redeem/consent-request/
  revoke endpoints, and `PtDataService`'s allow-listed reads, callable from
  both `PtAuthGuard` and `AdminAuthGuard` per Decision B4's oversight
  argument).
- **No third-party sub-processor introduced for authentication itself**
  beyond the three OAuth providers, which the project owner has already,
  directly chosen and reasoned about ("rely on their security") —
  distinct from this codebase's usual third-party-sub-processor caution
  (ADR-0010/0018/0020/0022 Decision 6), since delegating identity to a
  user's *own already-chosen* Google/Microsoft/Apple account is a
  different relationship than this app independently selecting a new
  vendor to process child data — no child data is involved in this
  decision at all (players are out of scope).
- **Legal/business judgments flagged, not decided silently, per this
  project's established practice**:
  - Whether Art. 8 self-consent extends to a 13+ player self-approving a
    specific PT's visibility into their own data, with no parent in the
    loop (Decision A3) — the same open question ADR-0019 Decision 1
    already flagged for a different processing purpose; recommend one
    real legal read covering both.
  - Whether SkillStreak ever wants to independently vet/credential PTs
    beyond SSO-provided identity (Decision A3) — not decided, a plausible
    future item tied to the (also explicitly out-of-scope) paid-plan
    business model.
  - The PT↔team financial-services/payments question and the broader
    "when is the app free vs. paid" question (`docs/BACKLOG.md`) remain
    fully open, undesigned, and untouched by this ADR, exactly as ADR-0022
    treated the same boundary for its own feature.
- **Left open, not decided here**: whether `birthYear` joins Decision A5's
  per-player allow-list (a small, additive follow-up, not included by
  default); a `PtProfile` entity for bio/credentials/photo (ux-designer
  territory, not architecturally required); PT/admin self-service account
  deletion (Decision A7, a real but different-shaped GDPR question,
  deferred); automating Apple's periodic client-secret JWT regeneration
  (Decision B6, a manual operational task for v1); a global cap on one
  PT's concurrently-pending consent requests (Decision A3, recommended,
  exact number left to implementation); whether Passport strategies are
  used instead of `openid-client` (Decision B6, backend-developer's call,
  not architecturally binding); the PT-authored/cross-team-reusable
  challenge-content idea and the video-verification points-tier formula
  (`docs/BACKLOG.md`) — both explicitly named there as needing their own
  separate architect passes, neither designed or precluded here.
- **Hand-off**:
  - **security-reviewer**: two passes, named separately in Status —
    Part A at ADR-0019's weight (the consent-gate mechanism end to end,
    the contact-change-hijack-race fix, the revocation cascade's
    correctness under concurrent revoke/re-approve, the rate-limiting on
    PT-initiated consent requests, and Decision A6's cross-team-reach
    argument specifically); Part B at ADR-0022's weight (the OAuth
    callback handling — token/claim validation, no raw provider token
    ever persisted, the `ADMIN_EMAILS` allow-list check happening on every
    login not just first login, the cookie/guard mechanics inherited from
    ADR-0022 Decision 2, and Decision B3's offline dev-session-minting
    script — confirming it truly has no network-reachable counterpart
    anywhere in the deployed image).
  - **ux-designer**: the PT's own web/app surface (team-link redemption,
    per-player consent-request UI, the read-only numbers view), the
    parent/self-approval review-and-approve email page (the actual
    plain-language description of what's being asked, mirroring the care
    ADR-0019's own review-page copy needed), the player-facing "manage
    your PT relationships / revoke" screen, and the captain-facing
    invite/revoke-team-link UI. The admin console's login screen changes
    from a password form to "Sign in with Google/Microsoft/Apple" buttons
    — a real, if small, UI change from ADR-0022's original design.
  - **backend-developer**: `staff-auth/` end to end, `pt/` end to end, the
    `StaffAccount`/`PtTeamLink`/`PtPlayerConsent` migrations, retiring
    `bcrypt`/`ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH`/`ADMIN_JWT_SECRET`
    from wherever ADR-0022's own backend-developer step had begun wiring
    them (confirmed not yet built at the time this ADR was written — see
    `docs/ACTION_PLAN.md`'s Phase 7 checklist), and the offline
    dev-session-minting script for `ubuntu01` testing (Decision B3).
  - **project owner**: registering three real OAuth applications (Google
    Cloud Console, Microsoft Entra admin center, Apple Developer's
    Services ID + Sign in with Apple key) and their production redirect
    URIs; maintaining `ADMIN_EMAILS`; the first real-domain SSO
    verification pass before PT signup opens (Decision B3); the legal read
    on the two open Art. 8 self-approval questions (this ADR's, and
    ADR-0019's) together, if pursued.

## Amendment — 2026-08-10: Part C — a player account may link to a trainer account, and what identity assurance can and cannot buy

**Status of this amendment: Proposed, 2026-08-10. Nothing in Part C may be
built before a blocking `security-reviewer` pass.** This is not a
formality inherited from the rest of the ADR: Part C touches
authentication (a second, differently-initiated path into the OIDC flow
that provisions `StaffAccount` rows) *and* child data (the people who will
use it are 16- and 17-year-olds who hold live player accounts, and the
whole point of Decision C6 is a hole in Decision A2's direction-of-
invitation invariant). Per CLAUDE.md's standing rule, that combination is
blocking on its own. The pass should be at Part A's weight (ADR-0019's),
and should treat Decisions C3, C6 and C7 as its centre of gravity.

**Requested by the project owner, 2026-08-10, verbatim**: *"A person who
creates an account as a user and is older than 16 should be able to
connect/convert their account to a Trainer account if they want to."* The
owner separately raised identity verification (BankID/Freja, and what
happens for people outside Sweden) — answered in Decision C9.

**The age threshold of 16 is the project owner's own decision, made
2026-08-10, and is not re-argued here.** 16- and 17-year-old assistant
coaches are ordinary in Swedish youth floorball, and a hard 18 would
exclude leaders that clubs already trust with the same children in a
gymnasium every week. What *is* argued below is what that number can and
cannot be relied on to mean (Decision C5), which is a different question
from whether it is the right number.

Part C adds no new role. A trainer here is the same `pt`-role
`StaffAccount` Decision B1 already defines, reached by a second route.
Every existing decision in Parts A and B stands unchanged; Part C adds one
join table, one flow, and one exclusion rule, and changes no existing
column, endpoint or guard.

### The fact everything below is shaped around

`Player.birthYear` is a self-declared `smallint`
(`backend/src/players/entities/player.entity.ts:34`), typed in during
onboarding and bounded only by `@IsInt()/@Min()/@Max()` in
`backend/src/onboarding/dto/create-player.dto.ts` — nothing verifies it,
and nothing ever could without collecting far more from a nine-year-old
than this app is willing to hold. Any age threshold built on it is a field
a twelve-year-old can fill in with 1995.

**Therefore: the age bar is not the safety control, and this amendment
must not be read as if it were.** What actually makes a trainer safe in
this design today is Decision A2's captain's code — a real person, running
a real team, vouching out of band for a specific human they know. That
vouching carries the weight; the age bar is a secondary filter that
catches honest mistakes and casual curiosity, and stops nobody who is
willing to lie. Every downstream decision here is sized to that reality:
nothing is granted by the link itself, and the checks that matter stay
where Part A already put them.

One mitigating fact, verified rather than assumed: `birthYear` has no
update path anywhere in the backend today (`profile.service.ts` reads it,
nothing writes it after `OnboardingService`), so a child who declared an
honest year cannot flip their own eligibility later without abandoning the
account and re-onboarding — which costs them the streak, the badges and
the team membership that are the entire point of the app. That is a weak
disincentive, not a control, and **`birthYear` must stay non-editable**;
adding an edit path later would silently turn eligibility into a
self-service toggle and would need its own review.

### Decision — C1: link, do not convert

**Decided: the two accounts coexist and are joined by an edge. Nothing is
converted, migrated, merged or destroyed.**

"Convert" was considered and rejected on two grounds, the first practical
and the second structural:

- **A player account is not a container that can be emptied and refilled.**
  `Player` is the anchor for `currentStreakCount`/`longestStreakCount`/
  `lastTrainedDate`, `bankedStreakSaverCount`, every `TrainingLogEntry`,
  every `BadgeAward`, `isCaptain` (with its one-captain-per-team partial
  unique index), team-pool contributions, chat authorship and the whole
  ADR-0013 erasure machinery. Converting means deleting or orphaning all
  of it — for a 16-year-old who is exactly the kind of long-tenured user
  this app most wants to keep.
- **The merged case is ordinary, not exotic.** An assistant coach who also
  plays, and logs their own training, is the normal shape of a
  16-year-old leader in this sport. One person, two roles, both intact, is
  the honest model. A conversion would force a false choice on the most
  engaged users in the app.
- **The two entities are different shapes on purpose.** `Player` is
  child-shaped: consent gating, `birthYear`, the `PlayerPrivateInfo` split,
  erasure rights, an 8-locale UI. `StaffAccount` is adult-shaped:
  SSO-provisioned, no consent flow, no private-info table, no erasure flow
  (Decision A7). A conversion would have to either drag the child-shaped
  scaffolding into the staff world or throw it away. A join row does
  neither.

**No column is added to `Player`.** The link lives in its own table for the
same reason `real_name` lives in `PlayerPrivateInfo` (ADR-0002 addendum
§1): `Player` is queried by leaderboards, feeds and badge lookups, and an
identity-joining `staff_account_id` sitting in that table is exactly the
kind of field a careless future `SELECT *` should not be able to return.

Naming note, per this codebase's own practice: user-facing copy says
*tränare*/trainer (`docs/TRAINERS.md`), the schema says `pt`. **Do not
rename `StaffAccountRole.PT`** — Part C introduces no new role, and a
rename would be a migration that buys nothing.

### Decision — C2: `StaffAccountPlayerLink` — one join table, one active link per player account

```
StaffAccountPlayerLink
  id                      uuid, PK
  staff_account_id        uuid, FK -> staff_account.id, ON DELETE CASCADE
  player_id               uuid, FK -> player.id, ON DELETE CASCADE
  eligibility_birth_year  smallint, not null
                             -- snapshot of Player.birthYear as it read at
                                link time. Audit only, never re-checked as
                                authority: it records what the app
                                believed, which is the only honest thing
                                this column can claim (see Decision C5)
  linked_at               timestamptz, not null
  unlinked_at             timestamptz, nullable
  unlinked_reason         enum, nullable: player_unlinked / staff_unlinked /
                                          staff_account_revoked
  created_at              timestamptz, not null
  -- partial unique index on (player_id) WHERE unlinked_at IS NULL — one
  -- active trainer identity per player account, ever. Same mechanism as
  -- idx_player_one_captain_per_team / idx_pt_team_link_one_active_per_team_pt
  -- (a partial unique index, not application logic alone), and the same
  -- "history stays, only one row is ever active" shape PtTeamLink already
  -- uses: re-linking after an unlink creates a new row.
```

**Deliberately *not* unique on `staff_account_id`.** A `Player` row is
single-team by construction (`Player.teamId` is scalar), so a human who
plays for two teams holds two player accounts, and one trainer identity
legitimately links to both. Forcing one would be wrong on the facts — and
worse, it would create a reason to unlink one account, which is precisely
the move Decision C6's exclusion is trying not to incentivise.

**Only a `pt`-role `StaffAccount` may hold a link.** If the SSO identity
completing the flow resolves to an account whose email is on
`ADMIN_EMAILS`, the link is refused (`409 staff_account_not_linkable`);
the account is still provisioned as `admin` per Decision B1's existing
behaviour, it simply gains no link. Admin already reads any consented
relationship (Decision B4) and is the project owner, so a link would buy
nothing and would only muddy Decision C6's exclusion. Named as a residual,
not hidden: **Decision C6's exclusion is meaningless for an `admin`
account**, which is fine for exactly the reason Decision B4 already gives.

### Decision — C3: the link is established by completing an SSO handshake started from an authenticated player session — reusing the existing callback, adding no new registered redirect URI

**Decided mechanism, four moving parts, all of which already exist:**

1. `POST /api/v1/players/me/trainer-link/start` — `JwtAuthGuard`, ordinary
   player session. Checks eligibility (Decision C5) and that no active
   link exists, then mints a **link-intent token**: 256 bits from
   `crypto.randomBytes(32).toString('hex')` (the `consent_token` shape, not
   `generateHumanCode` — nobody types this), stored **in Redis** with a
   10-minute TTL against `{ playerId, tokenVersion }`, single-use via the
   same atomic get-and-delete `RedisService.redeemPtTeamLinkInviteCode`
   already uses. Redis is correct here under ADR-0002's rule: an intent in
   flight is rebuildable by pressing the button again, and is never the
   only copy of anything durable. Returns `{ authorizeUrl, expiresAt }`.
2. The app opens `authorizeUrl` in a system browser. **`GET /api/v1/staff-
   auth/:provider/link?intent=...`** consumes the intent token, resolves
   the `playerId`, and writes it into the **existing signed
   `staff_auth_pending` cookie** alongside `state`/PKCE/`nonce` — the same
   place, and for the same reason, Decision B2/ADR-0022 Decision 10 put the
   step-up flag there rather than in a query parameter: *a caller must not
   be able to assert its own intent at the callback*.
3. **The existing `GET/POST /api/v1/staff-auth/:provider/callback` handles
   it — no new redirect URI, in any provider console, in any
   environment.** This is load-bearing under CLAUDE.md's environment-parity
   rule: every redirect URI is hand-registered per provider per
   environment (Decision B6), so a flow that needed a second one would
   triple that manual surface and create a new way for production and
   internal to diverge. The callback distinguishes a link flow from an
   ordinary login solely by what the signed pending cookie carries.
4. On success the callback provisions/refreshes the `StaffAccount` exactly
   as today, re-reads the player (rejecting if the row is gone or
   `tokenVersion` has moved on — a mid-flow session reissue *should*
   invalidate this), applies Decision C6's exclusion, and inserts the link
   row.

**The player JWT never enters the browser.** That is the whole reason for
the intent token: it is single-use, 10 minutes long, bound to one
`playerId`, and useless for anything other than this one insert. The
session itself stays in `expo-secure-store` where it lives today.

**Step-up (`prompt=login` + `max_age=0` + verified `auth_time`,
`StaffAuthService`) is considered and deliberately *not* required for
linking.** It exists and works, so this is a real choice rather than an
omission. The argument: the link grants zero access (Decision C4), so the
worst outcome of a link completed through an already-live IdP session is
"my account got linked to an identity I did not mean to link", which is
reversible in one tap (Decision C7). Meanwhile the player-side half of the
proof is already strong — an explicit in-app action, holding a live player
session. Requiring step-up would also collide immediately with the open
Apple question `docs/internal/ACTION_PLAN.md`'s Phase 8 UX pass (§12)
already raised, and this amendment declines to resolve that question as a
side effect of an unrelated feature. `state`/PKCE/`nonce` remain required,
unchanged, per Decision B6.

**Environment-parity consequence, named rather than discovered later**:
Decision B3 already establishes that no live OAuth handshake works on
`ubuntu01`, so **the trainer-link flow is not end-to-end testable there
either**, and `mint-dev-staff-session.ts` does not help — it mints a
session, not a link. Recommend extending that same offline script (or a
sibling) to insert a `StaffAccountPlayerLink` row directly, for exactly
Decision B3's argument: an offline script has no network endpoint anyone
can forget to disable. **Do not build a live "link without SSO" bypass
route.**

**Mobile cost, stated because it is real**: `mobile/package.json` today
contains no `expo-web-browser` and no `expo-auth-session` — this app has
never opened an external browser. Linking needs one
(`WebBrowser.openAuthSessionAsync`, the boring standard). That is a new
dependency on the mobile side and belongs in frontend-developer's estimate.

### Decision — C4: linking grants zero team access — a captain's code is still required, exactly as for an outsider

**The link is an identity edge and nothing else.** Completing it creates no
`PtTeamLink` and no `PtPlayerConsent`. A newly-linked trainer is, in
capability terms, indistinguishable from someone who signed in with Google
five seconds ago and has never met a team — which is exactly Decision B1's
existing default-zero-access posture, unchanged.

This falls out of the design rather than needing enforcement, and that is
the point: `PtDataService` resolves everything from `PtTeamLink` and
`PtPlayerConsent` (verified — `pt-data.service.ts` reads no other
relationship table), so **Part C requires no change to `PtDataService`,
`PtConsentService`, `PtAuthGuard` or any Decision A5 allow-list.** A new
table that no read path consults cannot widen a read path.

The converse also holds and should be said out loud in the UI copy: **being
a trainer grants the *player* account nothing.** No extra teammate
visibility, no roster powers, no exemption from anything. The two
identities do not lend each other authority in either direction.

### Decision — C5: the age bar is `Player.birthYear >= 16`, computed the same coarse way as the 13+ band — and is explicitly a secondary filter

**Mechanism**: a sibling of the existing util, not a new pattern —
`backend/src/common/age/trainer-link-age.util.ts`, exporting
`TRAINER_LINK_MIN_AGE_YEARS = 16` and
`isTrainerLinkAge(birthYear: number): boolean` computed as
`new Date().getUTCFullYear() - birthYear >= 16`. Same rolling-offset
reasoning as `isSelfVerificationAge` (no fixed cutoff to maintain), and the
same deliberate coarseness: an August-born and a January-born
16-year-old are treated identically, matching every other age decision in
this app. Checked at `trainer-link/start` **and** re-checked at callback,
because a 10-minute-old eligibility decision is cheap to re-derive and
free to get right.

**What this number can be relied on to mean: that the account holder typed
a birth year at least sixteen years ago.** Nothing more. Restating the
opening section because it is the single most misreadable thing in Part C:
`birthYear` is self-declared, so this bar filters honesty and inattention,
not intent.

**What therefore must never be built on top of it:**

- **No surface, anywhere, may describe a linked trainer as verified, adult,
  or checked.** Not in the app, not in the trainer console, and above all
  not in Decision A3's family-facing consent email, which is the one place
  a parent actually makes a trust decision. That email names the trainer's
  display name and email and lets the family judge — it must keep doing
  exactly that and claim nothing further.
- **No authorization decision may read the link as an age assertion.** The
  gates stay where Part A put them: an active `PtTeamLink` (a captain
  vouched) and an approved `PtPlayerConsent` (a family agreed).
- **A 16-year-old with a player account is still a child data subject in
  this app's own terms.** The link changes nothing about their player
  account's consent state, its erasure rights, its `PlayerPrivateInfo`
  handling, or the 13+ self-verification band they may already sit in. No
  field on `Player` changes. A person can simultaneously be a trainer to
  one team and a consent-gated child on their own.

Raising the bar later is a one-constant change plus a decision about
existing links. Lowering it, or trusting it further, is not a constant
change — it is a new review.

### Decision — C6: a person must never hold an active trainer link to a team they are a player in — enforced in one live resolver, not as a policy note

**The hole this closes, stated concretely**: without it, a captain hands
the invite code to a teammate who has just linked, and Decision A2's
direction-of-invitation invariant — *a team invites an outsider in* — is
bypassed from **inside** the team. The sharpest instance is a captain who
links their own account and redeems their own code, granting themselves the
team-aggregate tier plus the standing right to email every teammate's
family a consent request. Per-player parental consent (Decision A3) still
gates every byte of actual training data, so this is a hole rather than a
catastrophe — but it is a cheap one to close, and leaving Decision A2's
invariant true only from one direction would be an odd thing to write down
and not fix.

**Where the check belongs — the actual design question.** Today, "does this
PT hold an active link to this team" is answered independently in three
places: `PtDataService.getTeamAggregateViewsForPt`,
`PtConsentService.assertActiveTeamLink`, and implicitly by the unique index
in `PtTeamLinksService.redeemInvite`. Three answers to one question is
three places for an exclusion to be forgotten.

**Decided: introduce a single resolver — `PtTeamLinksService
.findActiveLink(ptStaffAccountId, teamId)` and `.listActiveLinks(
ptStaffAccountId)` — make all three call sites go through it, and put the
exclusion inside it**, as a `NOT EXISTS` against `staff_account_player_link`
joined to `player.team_id`, evaluated on every request. That is structural
in the sense this codebase already uses the word (Decision A5's "no method
returns player data without the check", ADR-0019 Decision 6's "never trust
a cached grant"): a consumer cannot express the unsafe query, because
there is only one function that answers the question.

**Why a live resolver and not only a check at redeem time.** Three
orderings are all reachable, and a redeem-time check catches one of them:
link-then-redeem (caught), redeem-then-link (missed), and
redeem-then-transfer-into-that-team-months-later (missed). A live check
catches all three and needs no backfill job.

**Also add fail-fast refusals at both write points, for the error message
rather than the guarantee**: `redeemInvite` → `403 pt_link_is_own_team`;
the link callback → `409 trainer_link_conflicts_with_active_team_link`.
Refuse, never auto-revoke — silently ending a `PtTeamLink` as a side
effect of an unrelated action is the kind of surprise this project has
consistently refused to build.

**Rejected: a Postgres trigger or exclusion constraint.** It is a
cross-table condition, so it would need a trigger, and a trigger is
invisible to the next contributor reading the entity file. The live
resolver sits exactly where this codebase already keeps its
relationship checks.

**Honest limits, both of them, because a rule that reads stronger than it
is would be worse than no rule:**

1. **The exclusion only binds people who actually link.** A teammate who
   never links is indistinguishable from an outsider — the app has no way
   to know a `StaffAccount` and a `Player` are the same human unless that
   human says so. Part C creates the link *and* the only means of
   detecting the case; it does not create the case.
2. **Unlinking dodges it.** Someone can unlink, redeem, and re-link — or
   simply never link. **Do not build an unlink cooldown or a
   "cannot unlink while holding team links" rule to chase this**: it adds
   friction for honest users against a bypass that is trivially reachable
   by doing nothing at all, and the thing actually being protected (the
   team-aggregate tier: screen names plus a consent-status flag) is, per
   Decision A6's own accepted residual, no more than a teammate's roster
   view already shows them.

The exclusion is structural hygiene that keeps Decision A2's invariant true
in both directions for anyone acting in good faith. **It is not a security
boundary, and the security-reviewer should read it as such.** The boundary
remains Decision A3.

### Decision — C7: unlink, account erasure, and player deletion

**Unlink is immediate, unconditional, and available to both sides** — the
posture Decision A4 already sets for every relationship in this ADR, and
ADR-0010/0013/0006 set for the app generally.

- **Player side**: `POST /api/v1/players/me/trainer-link/unlink`
  (`JwtAuthGuard`, ownership-checked). Sets `unlinked_at`,
  `unlinked_reason = 'player_unlinked'`. No counter-party, no waiting.
- **Trainer side**: `POST /api/v1/pt/player-links/:id/unlink`
  (`PtAuthGuard`, own row only), `unlinked_reason = 'staff_unlinked'`.
- **`GET /api/v1/pt/player-links`** returns the caller's own links only
  (screen name, team id, linked-at). No new data class: it is their own
  player account.

**Unlinking does not touch `PtTeamLink` or `PtPlayerConsent`, in either
direction.** A trainer who unlinks their player account is still the same
trainer with the same vouched-for team links and the same family-approved
consents; those have their own three revocation levers (Decision A4) and
must not be silently unwound by an identity-management action. Stated
explicitly so nobody later "tidies up" by cascading it. The one
consequence — that unlinking also lifts Decision C6's exclusion — is named
in C6 and accepted there.

**Account erasure (ADR-0013): free, no new code path, no new entry in
Decision 6's per-entity table.** `player_id` is `ON DELETE CASCADE`, and
`AccountErasureService` deletes the `Player` row directly
(`account-erasure.service.ts:562`), so the link row goes with it — the same
property ADR-0019's three tables and Part A's two tables already have. The
`StaffAccount` **survives**, correctly: it is an adult's own account,
provisioned from their own SSO identity, holding no child data of its own
(Decision A7 already defers staff self-deletion as a separate, differently
shaped question — unchanged here).

**Player deletion by any other path** (last-player-deletes-team, ADR-0013
Decision 5) behaves identically, via the same FK.

**`StaffAccount.revoked_at` set**: the link row stays but is inert, since
every consumer resolves through the staff account. Recommend
`unlinked_reason = 'staff_account_revoked'` be set at the same time for
legibility, by whoever sets `revoked_at` — an operational nicety, not a
correctness requirement.

**One thing for the security-reviewer to re-confirm rather than inherit**:
`PtAuthGuard` performs no per-request `StaffAccount` lookup and does not
check `revoked_at` (verified — `pt-auth.guard.ts`, and Decision B2 argues
this deliberately), so a revoked `pt` session stays usable until the 24h
cookie expires. Part C does not change that and its reasoning still holds
(the link grants nothing, and every real read re-checks a live
relationship). It is flagged only because the population of `pt` accounts
is about to include teenagers who are teammates of the children involved,
which is a different mental image than "an external professional" and
deserves a fresh look rather than a quiet inheritance.

### Decision — C8: what the app shows — and what it must not show to a player who is not eligible

Handed to ux-designer as constraints, not screens.

**Eligible (declared age >= 16, no active link)**: an entry point on the
profile screen — the honest version is a question, not a promotion. It
leads to a screen that explains, before any button: that this creates a
separate trainer identity, that the player account and its streak are
untouched, and that **being a trainer gives you no access to any team until
a team's captain gives you a code** (Decision C4, stated up front rather
than discovered as a disappointment). Then one action, which opens the
browser handshake, and a confirmation naming the linked email.

**Not eligible (declared age < 16)**: **render nothing at all.** Not a
disabled row, not "available from 16", not an explanatory tooltip. The
reasoning is specific and is the whole point: the single input that gates
this is the single input the child controls, so a visible-but-locked
control on a ten-year-old's profile is an advertisement for lying about
your birth year. This mirrors the existing precedent that the PT surface
"renders nothing at all until a PT relationship exists"
(`docs/internal/ACTION_PLAN.md`, Phase 8 UX pass) — absence, not a locked
door.

**Linked**: the linked email, when it was linked, an unlink control, and a
pointer to the trainer surface. **Keep it distinct from
`PtRelationshipsScreen`**, which is the player's view of *trainers who can
see them* — conflating "trainers watching me" with "I am a trainer" in one
list would be a genuinely confusing screen for a 16-year-old who is both.

**Never shown on the player side**: any team's trainer-side data, any other
trainer's identity, any claim of verification, and any hint that the link
confers access.

**Locale**: the player-app side of this is one of the app's 8
`PlayerLocale`s like everything else there. Whether the trainer console
itself is English-only remains the open split flagged in the Phase 8 UX
pass (§11.5) — **not decided here.**

### Decision — C9: identity assurance — model it as an assurance record, verify the capability not the account, and build none of it yet

Four questions get run together whenever "verification" comes up, and the
first job of this decision is to keep them apart:

| Question | Answered by | Answered today? |
|---|---|---|
| Who controls this mailbox? | SSO (Decision B1) | Yes |
| Is this person an adult? | age assurance | **No** |
| Which real legal person is this? | eID / document check | No |
| Should this person be near children? | background check | **No, and cannot be** |

**SSO answers only the first, and the ADR should say so plainly enough that
nobody later mistakes it for more.** Children hold Google and Apple
accounts routinely — school-issued and family-managed accounts are the
norm, not the exception. **Sign-in with Google is authentication, not age
assurance, and not identity assurance.** Decision A3's existing "why no
independent PT-identity verification beyond SSO" paragraph is correct as
written and stands; this decision only makes the boundary explicit and
says what the upgrade path looks like when the project wants one.

**C9a — model it as an assurance record, not a boolean `isAdult`.** A
boolean makes every future move a migration: adding a country, swapping
providers, raising the bar, or accepting a new credential type all change
what the boolean *means* without changing its type, which is the worst
version of a schema. Recommended shape, to be built when first needed:

```
StaffIdentityAssurance
  id                  uuid, PK
  staff_account_id    uuid, FK -> staff_account.id, ON DELETE CASCADE
  method              enum: sso_only | eid_broker | document_liveness |
                            eudi_wallet
  provider            varchar, nullable   -- 'signicat', 'criipto',
                                             'stripe_identity', ...
  scheme              varchar, nullable   -- 'se-bankid', 'no-bankid',
                                             'dk-mitid', 'freja', 'itsme',
                                             'idin', ...
  level               enum: none | self_declared | substantial | high
                              -- eIDAS-shaped vocabulary on purpose: it is
                                 the one assurance ladder every European
                                 scheme already maps onto
  subject_country     char(2), nullable
  verified_at         timestamptz, not null
  expires_at          timestamptz, nullable
  external_reference  varchar, nullable   -- the provider's own check id,
                                             for audit and dispute only
  created_at          timestamptz, not null
```

**Load-bearing exclusion: this table records *that* a check passed and at
what level — never the identity attributes themselves.** No personnummer,
no document image, no date of birth, no verified legal name. Those would
be a large new category of sensitive personal data on a system whose entire
design story is minimisation (ADR-0002 §1, ADR-0011), and this app has no
use for them: every downstream decision it makes is "did this person clear
bar X", not "who exactly are they". If a verified legal name is ever wanted
for display to families, that is a separate decision needing its own
argument and ADR-0011-style encryption — not a field to slip in here.

With this shape, EUDI is one more `method` value and one more broker
scheme, not a rewrite. That is the entire reason to prefer it over a
boolean.

**C9b — verify the capability, not the account.** Do not ask at signup.
Ask at the moment the person is about to gain access to a child's data.
Concretely, the right trigger is **redeeming a team code** (Decision A2
step 1) — that is the first moment anything at all becomes visible (the
team-aggregate tier: roster screen names and consent status), and it fires
once per team rather than once per child. Requesting per-player consent
(Decision A3) is the alternative trigger and is strictly later and noisier.

Why this ordering matters practically: Decision B1 provisions a `pt`
account for *any* successful SSO login, so the population of staff accounts
will be dominated by people who signed in, saw an empty screen, and never
came back. Most of them never reach a team code, so most are never asked
and no check is ever paid for that did not matter. Gating at signup would
invert that.

**C9c — vendor shape, when it is turned on.**

- **An identity broker is the right first integration, not a direct
  BankID one.** Signicat and Criipto are the obvious candidates: one
  integration, then enable schemes per country as coaches actually appear
  there — Swedish BankID, Norwegian BankID, Freja, MitID, FTN, itsme,
  iDIN. Signicat advertises access to dozens of European eID schemes
  through a single integration and is explicitly positioning the same
  integration to carry wallets as they roll out. One honest note for a
  build-vs-buy read: **Criipto was acquired by BankID BankAxept in 2024**,
  so it is no longer an independent Danish broker — that may be a
  reassurance or a concentration risk depending on the owner's view, but
  it should not be discovered after signing.
- **Document scan + liveness is the anywhere-in-the-world fallback**
  (Stripe Identity, Persona, Veriff, Onfido). List pricing sits in the low
  single-digit euros per check — roughly $1.50 for Stripe Identity, under
  a dollar for Veriff's base check, $2–5 for Persona, before volume
  negotiation. **Say the cost plainly, because cost is the reflexive
  objection and it does not survive contact with the numbers**: a project
  verifying tens of coaches a year is looking at a total annual spend in
  the tens of euros. Cost is not a reason to skip this. The reason to defer
  is that there is currently nothing to verify.
- **EUDI Wallet is the direction to design *for*, not to depend on or wait
  for.** Verified status as of this writing: eIDAS 2.0 obliges all 27 EU
  member states to make a wallet available to citizens and residents by
  **24 December 2026**, with EEA states (Norway, Iceland, Liechtenstein) a
  year behind, and acceptance obligations on regulated private-sector
  entities from **December 2027**. Readiness is uneven — fewer than a third
  of member states currently meet the readiness benchmark, with France,
  Italy and Poland ahead and the Netherlands among those signalling reduced
  scope at launch. So: a real standards track with real dates, and nothing
  a small app should block on in 2026. The assurance-record shape (C9a) is
  precisely what makes that a non-event later.

**C9d — recommendation: build none of this now.** No table, no vendor, no
integration. **The captain's code *is* the assurance mechanism today, and
this ADR should say that out loud rather than leave it implicit** — a
person who runs a real team vouched for a specific human they know, which
for a club-internal assistant coach is a stronger signal than any document
scan would give and is the only signal an identity check cannot supply. The
moment to revisit is when a trainer can reach a team *without* being
vouched for by one — a self-service trainer directory, or the
reputation/marketplace direction `docs/TRAINERS.md` already flags as
undesigned. An empty table built early is not cheaper than the migration it
was meant to avoid.

**C9e — what none of this solves, stated plainly because it is the most
important sentence in this decision.** **Verified identity tells you *who*
someone is. It tells you nothing about whether they should be near
children.** That is a background check — in Sweden an extract from
belastningsregistret for work with children, which the *individual*
requests from Polismyndigheten and shows to the club, and which the club
checks; elsewhere it has a different name and a different process
everywhere. **SkillStreak cannot perform it, cannot obtain it, and must
never imply it has.** BankID would not change that by a single degree.

What the app should do instead:

- **State the limit openly, in the two places it matters**: the
  trainer-facing copy (`docs/TRAINERS.md` already models the right voice
  with its "stated plainly" status box) and Decision A3's family consent
  email. Something with the plain meaning of: *SkillStreak confirms this
  person's sign-in, and nothing else. We do not run background checks. The
  club, and you, decide who works with your child.*
- **Leave the judgement with the club and the family, and keep the levers
  that make that judgement enforceable** — which Part A already has:
  captain-controlled team links, per-child family consent, and three
  independent immediate revocations (Decision A4).
- **Never ship a "verified trainer" badge or checkmark.** A family will
  read any such mark as vetting, and this app cannot back that reading.
  This is a hard constraint on ux-designer's trainer surfaces, not a
  preference.

### Explicitly NOT decided by this amendment

- **Whether the age bar should later differ by market**, or move at all —
  16 is the owner's decision and any change is a fresh one.
- **Whether an `admin` `StaffAccount` may link to a player account** —
  recommended refused (Decision C2); reversing that is a small follow-up
  if the owner wants it for their own testing.
- **Whether the trainer console is English-only or follows the player
  app's 8 locales** — the Phase 8 UX pass's open §11.5 split, untouched
  here.
- **Anything about a trainer's own account lifecycle** — staff
  self-deletion remains deferred exactly as Decision A7 left it.
- **Whether a linked trainer's *player* account should be treated
  differently anywhere in the app** — no, and Part C adds no mechanism
  that would let it.
- **Any paid, reputation, marketplace or directory dimension** — untouched
  (Context; `docs/TRAINERS.md`'s own status paragraph).
- **The open Art. 8 self-consent question** (Decision A3) — unchanged and
  still open; a 16-year-old linking a trainer account is *not* an instance
  of it, since linking involves no processing of any other child's data.

### Hand-off for Part C

- **security-reviewer** — **blocking, before any implementation**, at Part
  A's weight. Centre of gravity: Decision C3's intent-token flow (single
  use, TTL, `tokenVersion` re-check, the pending-cookie binding, and that
  the player JWT genuinely never leaves the app), Decision C6's exclusion
  (that the single resolver really is the only path, and that its stated
  limits are the true ones), Decision C7's erasure/unlink behaviour, and
  the `PtAuthGuard` `revoked_at` question flagged there.
- **backend-developer** — one migration (`staff_account_player_link` plus
  its partial unique index), `trainer-link-age.util.ts`, the three player
  endpoints, the two PT endpoints, the `/link` initiate route, the callback
  branch, **and the refactor of the three active-link call sites onto the
  single resolver in Decision C6 — which is the part most likely to be
  skipped and is the part the exclusion depends on.** Extend the offline
  dev script for `ubuntu01` per Decision C3.
- **frontend-developer** — `expo-web-browser` (new dependency), the profile
  entry point and its complete absence below the age bar (Decision C8), the
  link/unlink flows, and keeping the trainer identity visually distinct
  from `PtRelationshipsScreen`.
- **ux-designer** — the copy, which is where most of this decision's risk
  actually lives: the pre-link explanation that says "this grants you
  nothing yet" before the button, the confirmation, and the plain-language
  limit statement in Decision C9e for both the trainer surface and the
  family consent email. **No verification badge, no checkmark, no
  "verified" anywhere.**
- **project owner** — confirm Decision C2's admin refusal, and decide
  whether the C9e limit statement should also appear in
  `docs/legal/` alongside the existing published documents.


## Amendment, 2026-08-11 — `PtAuthGuard` now does a per-request account lookup; Decision B2's omission had expired

Decision B2 justified `PtAuthGuard` having no per-request `StaffAccount`
lookup on the grounds that a `pt` session "carries no ambient authority
whatsoever by construction ... until Part A's own consent chain
(PtTeamLink/PtPlayerConsent, **not built by this task**) grants something
specific". The parenthesis was the load-bearing part, and it stopped being
true when Part A shipped.

**The gap that left.** `StaffAccount.revokedAt` was read in exactly two
places — `AdminAuthGuard` and `StaffSessionViewService` — and nowhere in
`src/pt/`. A trainer holding an `approved` `PtPlayerConsent` therefore kept
full access to a named child's screen name, both streak counters, complete
`TrainingLogEntry` history and badges **after being revoked**, indefinitely:
`refreshExistingAccount` explicitly did not check `revokedAt` either, so it
minted fresh sessions and the 24h expiry never bounded it.

That matters more than an ordinary stale-session window because of who
holds the other levers. Team-link revocation belongs to the captain and
consent revocation to the parent or child; `revoked_at` is the **operator's
only unilateral lever**, and `StaffAccount.revokedAt`'s own docstring
describes it as ending "every current and future session immediately". On
the half of the system that touches children's training data, it did
nothing at all.

**Fixed**: `PtAuthGuard` now performs the same lookup `AdminAuthGuard`
always has, rejecting a revoked account and a missing row; and
`completeLogin` refuses to issue a session to a revoked account.
Decision B2's cost argument for omitting it — "the high-volume player
request path" — never applied here: `/pt` is a handful of adults at human
frequency, the same shape as `/admin`.

**Found by** the security review of the admin-as-trainer change. That
change was itself sound — the reviewer confirmed all four `/pt` routes
authorise on a live relationship and none on role — but it restated
B2's premise, which is how the staleness surfaced. Worth recording,
because the finding was not in the diff under review.

**Decision B4 correction**: it specifies the two guards as "each adding
exactly one extra check: `staffRole === 'admin'` or `staffRole === 'pt'`
respectively". `PtAuthGuard` now admits either role, and adds the
revocation lookup. Both members of `StaffAccountRole` are currently in
that allow-list, so the role check constrains nothing today — it is a
guard rail for a third role, and the code says so rather than implying a
live constraint.

**Still open, recorded rather than fixed**: `PtPlayerConsent` snapshots the
parent's contact but not the trainer's name, email or role, and all three
are re-read live from `StaffAccount` — which is overwritten on every
login. So the name a parent approved can silently change. The reviewer
recommends `pt_display_name_snapshot` / `pt_email_snapshot` /
`pt_role_at_request`, and a decision on whether an `ADMIN` account may hold
PT relationships in production at all, or only on `ubuntu01`.
