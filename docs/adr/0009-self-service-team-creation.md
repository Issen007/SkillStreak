# 0009 - Self-service team creation at onboarding

## Status

Accepted — 2026-07-09

## Context

Onboarding step O1 (`docs/design/phase1-flows.md`, `GET /api/v1/teams/invite/:inviteCode`,
`docs/api/phase1-contract.md`) has always dead-ended on an unmatched invite
code: `404 invite_code_not_found`, "double-check with your coach," go back
and retry. Team creation itself has been a seed/admin-only action since
Phase 1 (`docs/adr/0002-data-model.md`'s `Team` entity comment, "no coach
self-serve team creation endpoint — teams are seeded"), carried forward
unchanged through ADR-0004's addendum (coach account creation "out of
scope, same posture as Phase 1 treated team/invite-code creation") and
ADR-0005 Decision 1 (captain assignment "the same posture Phase 1 already
took for team creation").

The project owner's explicit instruction, not re-litigated here: when an
invite code doesn't match any team, the person onboarding should be able to
create a brand-new team right there, become its first player, and
**automatically become that team's captain**. Two further product decisions
are confirmed and not re-litigated:

1. The new team's name is checked against the same content-safety mechanism
   already built for chat (`ChatModerationCheck`/`KeywordChatModerationCheck`,
   `docs/adr/0007-team-chat.md` Decision 2) — because ADR-0008's leaderboard
   makes `Team.name` cross-team-visible, and that ADR's own sign-off note
   ("no team has ever been seeded with a name that itself encodes something
   sensitive") stops being true the moment any child can type a team name
   directly.
2. A newly self-created team gets a working `Season` + active
   `TeamSeasonPot` atomically with team creation — not a manual follow-up
   step, closing (for this one case) the gap `season.entity.ts`'s file
   comment and ADR-0008 Decision 2 already flagged as accepted-but-open.

This ADR resolves the remaining open design questions: exactly where in the
request flow creation happens, what becomes the new team's invite code, what
(if anything) changes about the existing `404`, and how creation composes
with every existing captain/consent/season invariant without touching any of
them.

## Decision — 1: creation happens inside `OnboardingService.createPlayer`'s existing transaction, not a separate `POST /teams` call

**Confirms the architect's own stated read.** `OnboardingService.createPlayer`
already wraps team-join, `Player` shell creation, `PlayerPrivateInfo`, and
the first `ParentalConsentRecord` in one Postgres transaction
(`docs/adr/0002-data-model.md`'s 2026-07-03 addendum §2). A separate,
earlier `POST /teams` call — made before the name/avatar/birth-year/consent
screens (O3-O5) run — would risk exactly the orphaned-team failure mode
those screens exist to avoid for players: a team with zero players and no
captain if the flow is abandoned partway through, permanently occupying an
invite code with no path to reuse it (teams have no delete/rename feature
today, so an orphan would be permanent). Extending the existing
onboarding transaction so team creation is optional-and-atomic, only
committed once the whole shell (team + player + consent record) is ready
together, is both the safer shape and the boring, no-new-endpoint option.

**Consequence:** `POST /teams` is not added to the contract. Team creation
has exactly one entry point — `POST /players` — same as it's always had
exactly one entry point (a seed script) before this ADR.

## Decision — 2: request/response contract shape

`docs/api/phase1-contract.md`'s `POST /api/v1/players` currently takes
`{ inviteCode, screenName, avatarId, birthYear, parentContact }` and no auth.
This ADR adds exactly one new, optional request field and three new,
additive response fields — see the contract addendum in
`docs/api/phase1-contract.md` for the full shape. Summary:

- **Request gains `teamName?: string`** — present if and only if the client
  already knows (from a prior `GET /teams/invite/:inviteCode` `404`) that
  `inviteCode` doesn't match any team and the player has chosen to create one
  instead of retrying. Absent `teamName` → byte-for-byte the existing Phase 1
  behavior (`404 invite_code_not_found` if the code doesn't match anything).
  This makes the change purely additive/backward-compatible: a mobile build
  that never sends `teamName` sees no behavior change at all.
- **Response gains `teamName`, `teamCreated`, `isCaptain`** — `teamName`
  echoes the team's actual name (the joined team's existing name, or the
  just-created team's accepted name) so the client has a durable confirmation
  without re-deriving it from the O2 preview step, which never ran in the
  create path. `teamCreated: boolean` and `isCaptain: boolean` are separate,
  explicit fields rather than letting the client infer "I created my team"
  from `isCaptain: true` — `isCaptain` could in principle be true for a
  reason unrelated to creation in a future feature, so collapsing the two
  into one implied signal would be a fragile coupling.

### Server-side algorithm (`OnboardingService.createPlayer`)

```
team := TeamsService.findByInviteCode(dto.inviteCode)      // outside the tx, as today — fail fast

if team is null and dto.teamName is absent:
    throw InviteCodeNotFoundException                       // unchanged Phase 1 behavior

dataSource.transaction(manager =>
    teamCreated := false
    if team is null:                                         // dto.teamName is present here
        try:
            team := TeamsService.createTeam(manager, { name: dto.teamName, inviteCode: dto.inviteCode })
            teamCreated := true
        catch uniqueViolation on team.invite_code:
            throw InviteCodeTakenConcurrentlyException        // see Decision 6
        TeamPoolService.createInitialSeasonAndPot(manager, team.id)

    player := PlayersService.createShell(manager, {
        teamId: team.id, screenName, avatarId, birthYear,
        isCaptain: teamCreated,                                // the ONLY place isCaptain is set true at shell-creation time
    })
    ...unchanged: PlayerPrivateInfo, ParentalConsentRecord, consent token...
)
```

If `team` was found by the initial lookup (the ordinary join case) but
`dto.teamName` was also (redundantly, or stale-client-state) supplied, it is
silently ignored and the player simply joins the existing team — no new
error code for this combination. Rationale: the only realistic ways to reach
it are (a) the harmless race in Decision 6, where the client's premise
("this code is free") became stale between the O1 preview and the O5
submit, and (b) a client bug sending a stray field. Both are better served
by "just join the team that's actually there" than by a confusing error
about a field the join path was never going to use — consistent with this
project's general preference for forgiving the *unimportant* mismatch while
being strict about anything with a real safety/integrity stake (contrast
Decision 6, where the *important* case — two different teams racing for one
code — does get an explicit error).

`TeamsService.createTeam` is the single entry point for creating a `Team`
row anywhere in this codebase (seed script included, if it's ever updated to
call it instead of `repository.save` directly — not required by this ADR,
but noted as the natural cleanup). It performs the moderation check itself
(Decision 5) before saving, so "create a team" and "team name was checked"
cannot be structurally separated by a future caller who forgets to check
first — the same "boundary enforced by code shape, not caller discipline"
reasoning ADR-0002's addendum already applies to `PlayerPrivateInfoModule`.

## Decision — 3: the originally-typed invite code becomes the new team's invite code — not a generated one

Two options, weighed directly (per the task's instruction to evaluate, not
just assert):

**A — reuse the typed code.** No extra field, no extra screen, zero added
friction; already proven unique by construction (the lookup that triggered
this whole path just returned `404` for it); and it's a continuation of the
existing UX pattern, not a new concept — invite codes in this app have
always been human-chosen, human-shared, spoken-at-practice strings
(`FALKEN13`), never opaque system tokens, so a kid typing a memorable code
they intend to repeat to recruit teammates is exactly the intended shape of
this field, just authored by a different kind of user than before.

**B — generate a random code, discard what was typed.** Guarantees a
consistent code "quality" (no `TEST123`/`ABC` becoming permanent), but at
real cost: a generation-plus-uniqueness-retry loop, and — worse for this
audience — a new screen is *required* just to show the kid the code they
now actually need (since it no longer matches what they typed), which is
more UI, more reading, and a confusing "I typed X but my team's code is
actually Y" moment for exactly the age group this app is built for.

**Decision: A.** It's the boring option, it's the lower-friction option, and
it's what the task text itself was already leaning toward. The one
accepted downside — a low-entropy or throwaway-looking code becoming
permanent — is not a new category of risk: invite codes were already
documented as "deliberately low-entropy... brute-forceable" at the `GET`
endpoint (`teams.controller.ts`'s existing comment); this extends that
same, already-accepted shape to self-chosen codes, it doesn't introduce a
new one. Teams have no rename/re-code feature regardless of who created
them — consistent with every other "first free-text input, no edit path
yet" gap already in this app (e.g. `screenName` is editable per ADR-0002,
but nothing else customizable at onboarding is).

**Flagged, not decided here:** the moderation check (Decision 5) is
confirmed for the team **name** only, per the project owner's own wording.
Should the same check also run against the **invite code** itself before
accepting it as permanent? Unlike a coach-chosen code (an adult, and never
previously validated either), a self-service-created code is now
potentially child-chosen *and* will be repeatedly spoken/typed by that kid
to recruit every future teammate — a rude or otherwise inappropriate code
persists indefinitely as literally the app's onboarding password for that
team. This is cheap to add (the same `ChatModerationCheck.check()` call,
run twice) and closes an adjacent gap the two confirmed product decisions
don't cover. Recommending it; not silently bundling it into "already
decided" scope, since the project owner scoped the confirmed decision to
the *name* specifically.

## Decision — 4: `GET /teams/invite/:inviteCode`'s existing `404` needs no new signal

The endpoint has exactly one failure mode today: no team matches the code.
There is no second reason it can return `404`, so — **unlike, say, a generic
"not found" that could mean several different things — this `404`'s meaning
is already unambiguous: the code is available.** No new response field
(e.g. a `canCreateTeam: true` hint) is needed for the client to safely offer
"create a new team instead" off the existing error; adding one would be
signaling information the client can already derive with certainty from the
status code and error code alone. **No contract change to this endpoint.**

What *does* change is purely a UX/frontend concern, flagged for
ux-designer/frontend-developer, not a backend contract shape: O1's current
copy ("Vi hittade ingen lag med den koden... Dubbelkolla med din tränare!")
assumes the only next action is retrying the code. A new screen/branch
offering "skapa ett nytt lag istället" needs designing — this ADR doesn't
design it, it only confirms the API underneath it needs no new field.

## Decision — 5: team-name moderation reuses `ChatModerationCheck` via a new shared `ModerationModule`, not a second filter

Per the confirmed product decision and `docs/adr/0007-team-chat.md`
Decision 2's explicit design intent (a swappable `ChatModerationCheck`
interface bound via the `CHAT_MODERATION_CHECK` DI token specifically so a
future non-chat consumer isn't locked out). Two ways to actually reuse it
were considered:

- **Import `TeamChatModule` into `OnboardingModule`/`TeamsModule`.** Rejected:
  `TeamChatModule` also registers `TeamChatMessage`/`TeamChatBlock`/
  `TeamChatMessageReport` entities and imports `MailModule`/`RedisModule`/
  `PlayerPrivateInfoModule` for reasons that have nothing to do with checking
  a string against a wordlist — pulling all of that into the onboarding path
  is exactly the kind of incidental coupling this project's module-boundary
  ADRs (0002 addendum §1, 0007's own boundary note) consistently avoid.
- **Extract the DI binding into a new, minimal `backend/src/moderation/`
  module** that owns *only* the `{ provide: CHAT_MODERATION_CHECK, useClass:
  KeywordChatModerationCheck }` registration and exports the token.
  `TeamChatModule` imports it instead of declaring the binding itself;
  `TeamsModule` imports it too, so `TeamsService.createTeam` can inject
  `ChatModerationCheck` the same way `TeamChatService` does. **This is the
  decision.**

The interface, its DI token, the keyword implementation, and the wordlist
file (`chat-moderation-check.interface.ts`, `keyword-chat-moderation-check.ts`,
`swedish-filter-wordlist.json`) **do not move and do not get renamed** —
only where the provider *binding* is declared changes. This is a deliberate
minimal-diff choice: those files are already-shipped, already
security-reviewed Fas 2.6b code (ADR-0007's "blocking security-reviewer
sign-off" note), and renaming/relocating them for a naming purity argument
("it's not really chat-specific anymore") would be exactly the kind of
churn-for-its-own-sake CLAUDE.md and this project's other ADRs (e.g.
ADR-0005 declining to rename `Challenge`) consistently reject. A future
contributor reading `ChatModerationCheck` from `teams.service.ts` will find
a one-line comment pointing at this ADR for why a chat-named interface is
being used to check a team name.

**Net result: one seam, one binding, two consumers.** Swapping the keyword
implementation for an LLM-backed one later (`docs/BACKLOG.md`'s deferred
item) changes one provider binding in `ModerationModule` and both team-chat
and team-name-at-creation pick it up automatically — the outcome ADR-0007
Decision 2 was already designed to make possible.

## Decision — 6: `Season` + `TeamSeasonPot` created atomically; closes the rollover gap only for the self-created-team case

`TeamPoolService` gains `createInitialSeasonAndPot(manager, teamId)`,
called only from the team-creation branch above (never for an ordinary
join, and never touching an existing team's pot). Defaults, chosen for
consistency with this project's own existing seed data rather than
inventing a new shape:

- **`label`** — the same Swedish half-year convention `seed.ts` already
  uses ("Vår 2026" for a team seeded Jan-Jun, "Höst 2026" would be the
  equivalent for Jul-Dec, if seed data ever needs it): computed from the
  creation date's month, not hardcoded.
- **`start_date` / `end_date`** — the calendar half containing the creation
  date (Jan 1-Jun 30 or Jul 1-Dec 31 of the creation year), **not** a
  floating "today + N days" window. This is a deliberate choice over the
  "today through some fixed duration" option the task also floated: aligning
  every team's season to the same fixed calendar grid, whether seeded or
  self-created, is what actually keeps ADR-0008's leaderboard as close to
  apples-to-apples as this project is willing to engineer for right now — a
  floating window would introduce a *second, different* season-shape
  variable into a comparison ADR-0008 already flagged as fragile, for no
  benefit.
- **`goal_threshold`** — reuse the seed script's existing constant (5000).
  Per ADR-0008 Decision 4, this column is already dormant/unused by any
  current response — its exact value has no product effect today, but a
  `NOT NULL` column still needs a value, and reusing the seed's own number
  avoids inventing a second magic constant. Flagged for backend-developer:
  extract this as a shared named constant used by both the seed script and
  this new path, rather than two separately-hardcoded `5000`s drifting apart
  later.
- **`status`** — `active`, same as every seeded pot.

**New migration alongside this feature: a partial unique index,
`idx_team_season_pot_one_active_per_team ON team_season_pot(team_id) WHERE
status = 'active'`.** Not required for *this* feature's own correctness —
every pot it creates belongs to a freshly-generated `team_id` that
structurally cannot already have one — but this is precisely the gap
`docs/ACTION_PLAN.md` already named as "not reachable while pot creation is
seed-only, but relevant once Phase 2 builds season rollover." This feature
is the first real (non-seed, non-admin-reviewed) pot-creation code path in
the app; adding the same DB-level backstop this project already applies to
every other "at most one active X per team" invariant
(`idx_player_one_captain_per_team`, ADR-0005;
`idx_challenge_one_active_goal_per_team`, ADR-0005) the moment a real
non-seed writer exists is the proactive-close-the-gap move this project's
own ADRs repeatedly praise over letting a known gap linger. No
catch-and-translate exception is needed for it in this feature's own write
path (the violation genuinely can't occur here) — it's a backstop for
future code, e.g. an eventual season-rollover feature, not a check this
feature itself will ever trip.

### Does this close ADR-0008's season-rollover gap?

**No — only for the self-created-team case, stated plainly per the task's
explicit ask.** An **existing, previously-seeded** team still has no
rollover path whatsoever: when its `Season.end_date` passes, nothing
automatically closes its `TeamSeasonPot` or opens a new one — that's
exactly as true after this ADR as before it. What changes is narrower: a
**newly self-created** team can no longer end up with zero pot at all
(the specific failure mode `TeamPoolService.getActivePotForTeam` already
guards against with a `500`, which was previously only reachable via an
incomplete seed run) — but once that team's own first season ends, it hits
the *exact same* unsolved rollover gap every other team already has. This
ADR closes "a self-created team can be born without a pot," not "any team
can run out of season."

## Decision — 7: captain assignment fits the existing invariant unchanged

`Player.is_captain` stays a plain boolean with the existing partial unique
index (`idx_player_one_captain_per_team`, ADR-0005 Decision 1) as the sole
enforcement mechanism — **no schema change.** A brand-new team's creator is
simply the one existing player on that team with `is_captain = true` set at
`INSERT` time, which trivially satisfies "at most one active captain per
team" (there are zero other rows to conflict with). `PlayersService
.assertIsCaptainOfTeam` and every endpoint already gated on it
(weekly-goal management, roster, session-reissue, consent-reminder-resend,
captain-transfer per ADR-0006) work against this new captain with no code
change — captaincy has always been "read the boolean off whichever `Player`
row happens to have it," and this ADR only adds a new way that boolean gets
set to `true`, at the same point in the row's lifecycle (creation) rather
than after the fact (seed script, or ADR-0006 transfer).

## Decision — 8: the invite-code creation race — an explicit error, not a silent fallback

Two independent onboarding sessions could, in principle, both see `404` for
the identical made-up code and both attempt to create a team with it. This
is caught by the existing `UQ_da387f0c2e17d1e1e09f2836adf` unique
constraint on `team.invite_code` — the second `INSERT` inside
`TeamsService.createTeam` fails with a Postgres unique violation, caught via
the existing `isPostgresUniqueViolation` helper, and surfaced as a new
**`409 invite_code_taken_concurrently`.**

A "graceful" alternative was considered and rejected: catching the
violation, re-fetching the team the *other* request just created, and
silently falling back to joining it instead (discarding the loser's
`teamName` and never making them captain). Rejected because it's
meaningfully more code (a second read-after-catch, a decision about whether
to still run the ordinary join path mid-transaction) to protect against an
extremely rare race — two independent people typing the exact same
not-yet-existing code within the multi-screen O1→O5 window — and because
this project has a consistent, stated preference for an explicit error over
a silent reinterpretation of what the user asked for whenever the two
diverge in something that matters (ADR-0006's `captain_transfer_target_is_self`
"a clear error rather than a confusing 'nothing happened' response";
ADR-0007 Decision 1's "reject with a clear error, don't silently mutate").
Losing a race to create your own team, then being silently enrolled as an
ordinary member of a stranger's team instead, is exactly the kind of
surprising silent reinterpretation that precedent argues against. The loser
gets a clear `409`, goes back to O1, and either the code is now genuinely
taken (by the team that just won the race) — a real, informative outcome —
or they can pick a different one.

## Flagged — adjacent risks not covered by the two confirmed product decisions

Per the task's explicit instruction to surface anything adjacent, not just
the already-decided "should a child become captain" question:

1. **A newly self-created captain can exercise every captain-only authority
   immediately, before their *own* parental consent is approved.** Every
   captain-gated endpoint today (`assertIsCaptainOfTeam`) checks
   `isCaptain` + team membership only — never the acting captain's own
   `parentalConsentStatus`. This gap has existed on paper since ADR-0005,
   but was never practically reachable: a seed-created captain has consent
   pre-approved by the seed script, and an ADR-0006 transfer target is, by
   construction, an already-onboarded (and in every real scenario so far,
   already-approved) player. **This feature is the first realistic path
   where a captain exists whose own consent is still `pending`** — the very
   first action after the onboarding shell commits sets `is_captain = true`,
   before any consent email has had time to be opened. A still-pending
   9-year-old could, immediately, set their team's weekly goal, view
   teammates' consent status via the captain-only roster endpoint (once
   there are teammates), and trigger a teammate's session-reissue code —
   none of which is currently gated on the *acting* player's own consent
   state, only the target's where relevant. This is adjacent to, not the
   same as, the already-decided "should the creator become captain"
   question — flagged for product/security-reviewer sign-off on whether
   captain-*actions* (not the flag itself) should also require the acting
   captain's own consent to be `approved`, mirroring the precedent that
   consent already gates every other "substantive" action in this app.
2. **New abuse surface: team-creation spam.** `POST /players` is already
   throttled at 10/min/IP (sized for a coach registering ~15 kids). Before
   this ADR, that throttle bounded "junk players on a real team." After it,
   the same throttle bounds "junk teams, each with a real `Season` +
   `TeamSeasonPot` row" — a strictly heavier action per request. Not
   severe at this project's current beta scale (per CLAUDE.md's phase
   framing), but a materially different failure mode than before and worth
   a security-reviewer look rather than an assumed-fine carry-over of the
   existing number.
3. **Self-created "dead" teams are now possible in a way seeded teams never
   were.** If parental consent is never approved (or is revoked) for a
   self-created team's sole player, the `Team`/`Season`/`TeamSeasonPot` rows
   persist forever with nobody ever able to log training — this app has no
   team/player deletion feature at all today (ADR-0006 already notes
   "player deletion isn't a feature that exists yet either"), so this is
   consistent with, not a new category beyond, the existing no-cleanup
   posture — flagged for completeness, not as a new gap to fix here.
4. **No confirmation step before an *irreversible* team creation.** O2
   ("Ansluter du till {teamName}?") exists specifically so a kid who
   fat-fingers a *valid* code can back out before anything is created. There
   is no analogous confirmation for the create path — under this ADR's
   contract, `teamName` simply rides along with the rest of the O3-O5 form
   fields and the team is created the moment `POST /players` succeeds, same
   as the player row is. A typo in the *code* at O1 (now potentially
   creating a permanent duplicate/junk team rather than just failing to
   join) has no "wait, are you sure?" gate the way joining an existing
   team does. This is a real UX/product gap, not a backend contract one —
   flagged explicitly for ux-designer's flow pass, not silently left
   implicit in "O3-O5 already collect the rest of the fields anyway."
5. **`Team.name` becoming child-authored is a new instance of a boundary
   ADR-0008 already flagged, not a new boundary.** ADR-0008 already
   established `Team.name` as cross-team-visible via the leaderboard and
   flagged it for a security-reviewer sanity check; this ADR is the reason
   that check stops being "probably fine, no team has ever been seeded with
   a bad name" and becomes "actively enforced by a filter," per the
   project owner's own confirmed decision — noted here only so the two
   ADRs' reasoning is traceable to each other, not as a new open question.

## Consequences

- **Additive, backward-compatible contract change** — unlike ADR-0008. Every
  new field (`teamName` request, `teamName`/`teamCreated`/`isCaptain`
  response) is optional-on-request or additive-on-response; a client that
  never sends `teamName` sees byte-for-byte Phase 1 behavior, including the
  existing `404`.
- New migration: `idx_team_season_pot_one_active_per_team` partial unique
  index (Decision 6) — additive, no data-loss risk (mirrors two existing
  indexes of the same shape).
- New module `backend/src/moderation/` owning the `CHAT_MODERATION_CHECK`
  binding; `TeamChatModule` and `TeamsModule` both import it instead of
  `TeamChatModule` declaring the binding alone. No file moves/renames to
  already-shipped Fas 2.6b files (Decision 5).
- `TeamsService` gains its first write method (`createTeam`) and its first
  non-`Team`-only dependency (`ChatModerationCheck` via `ModerationModule`).
  `TeamPoolService` gains `createInitialSeasonAndPot`. `PlayersService
  .createShell`'s input gains an `isCaptain` field (default `false`,
  unchanged for every existing call site).
- New exceptions, following this codebase's existing `AppException`
  pattern exactly: `TeamNameRejectedByFilterException`
  (`422 team_name_rejected_by_filter`, mirroring
  `ChatMessageRejectedByFilterException`'s shape) and
  `InviteCodeTakenConcurrentlyException` (`409
  invite_code_taken_concurrently`).
- `backend/src/teams/entities/team.entity.ts`'s class comment ("Phase 1 has
  no coach self-serve team creation endpoint — teams are seeded") is now
  stale and needs updating alongside implementation — flagged for
  backend-developer, not fixed by this document.
- Five adjacent risks flagged above, none silently resolved: acting-captain
  consent-gating on captain-only endpoints, team-creation abuse/rate-limit
  posture, permanently-orphaned self-created teams, the missing O1
  create-confirmation UX step, and the (recommended, not decided)
  invite-code moderation check. security-reviewer and ux-designer should
  each pick up the ones in their lane before this ships, per CLAUDE.md's
  standing rule that auth/child-data-adjacent changes get a blocking review.
- See `docs/api/phase1-contract.md`'s 2026-07-09 addendum for the exact
  request/response shapes backend-developer and frontend-developer build
  against.
