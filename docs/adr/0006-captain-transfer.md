# 0006 - Captain reassignment (Fas 2.6a)

## Status

Accepted — 2026-07-08

## Context

`docs/ACTION_PLAN.md`'s Fas 2.6a: "In the Team ('Laget') tab, you should see
the entire team and who is the capten, but also be able to assign a new
capten." Two gaps against ADR-0005's design:

1. `Player.is_captain` is currently only ever set out-of-band (a
   backend-developer seed/admin script, per ADR-0005 Decision 1's
   "Assignment mechanism") — there is no in-app way to change captaincy once
   a team is running.
2. No response in `docs/api/phase2-contract.md` surfaces *who* the captain
   is to anyone other than the captain themselves (the captain-gated roster
   endpoint shows consent detail, not a captain flag; the dashboard only
   returns `viewerIsCaptain`, i.e. "is it me," never "who is it").

This ADR does not reopen anything ADR-0005 already decided: `is_captain`
stays a boolean column, the partial unique index
(`idx_player_one_captain_per_team`) stays the enforcement mechanism, and
authorization stays a service-layer check (`PlayersService
.assertIsCaptainOfTeam`), not a new guard class. What's new here is *who can
change the flag* and *how the roster reflects it*.

There is no adult/coach account reachable in this app (ADR-0004's addendum,
ADR-0005's pivot) — so "who is authorized to hand off captaincy" has exactly
one candidate that doesn't reintroduce a second identity system: **the
current captain, self-service, handing off to a named teammate.** This is
the same trust model ADR-0005 already established for consent-reminder and
session-reissue — "a captain is just a flagged peer, not an authority above
the other kids" — extended to captaincy itself. The alternative (a
team-wide vote/election) is a materially bigger feature (ballot state,
quorum, timing) that ACTION_PLAN's Fas 2.6a wording doesn't ask for and
that isn't designed here.

## Decision — 1: self-service transfer, gated on being the current captain

**`POST /api/v1/teams/:teamId/captain-transfer { newCaptainPlayerId }`,
callable only by the team's current captain, targeting any other player on
the same team.** No new guard class — reuses
`PlayersService.assertIsCaptainOfTeam(requesterId, teamId)` exactly as
every other Phase 2 captain-gated endpoint does.

### Why the *current* captain, not e.g. "any player nominates, majority accepts"

The task frame for this ADR was decided by the project owner as final: the
current captain hands off, self-service. This is also the boring option —
it needs no new state machine (no pending nomination, no accept/decline
step), fits the "captain is a peer with one flag" model exactly as-is, and
mirrors how the role was created in the first place (an out-of-band decision
by whoever currently holds the authority to make it — previously
seed/admin, now the captain themselves).

### Transaction shape — no window with zero or two captains

Mirrors `WeeklyGoalService.patchGoal`'s row-lock pattern (a `dataSource
.transaction`, row-locked reads before any write), not the plain two-`UPDATE`
sketch in ADR-0005's Decision 1 (that sketch was written for an
out-of-band admin script, where "who's calling this and are they allowed to"
wasn't a concurrency-relevant question — an in-app, player-triggered
endpoint needs the authorization check itself to be race-free, not just the
column update).

```
dataSource.transaction(async (manager) => {
  const requester = await playersService.findByIdForUpdate(manager, requesterId);
  if (requester.teamId !== teamId) throw new TeamMismatchException();
  if (!requester.isCaptain) throw new NotTeamCaptainException();

  if (newCaptainPlayerId === requesterId) {
    throw new CaptainTransferToSelfException();
  }

  const target = await playersService.findByIdForUpdate(manager, newCaptainPlayerId);
  // findByIdForUpdate already throws PlayerNotFoundException if missing
  if (target.teamId !== teamId) throw new CaptainTransferTargetNotOnTeamException();

  requester.isCaptain = false;
  await manager.getRepository(Player).save(requester);
  target.isCaptain = true;
  try {
    await manager.getRepository(Player).save(target);
  } catch (error) {
    if (isPostgresUniqueViolation(error, 'idx_player_one_captain_per_team')) {
      // Should be unreachable given the locks above — kept as a backstop,
      // same posture as WeeklyGoalService's equivalent catch for the
      // one-active-goal index.
      throw new CaptainTransferConflictException();
    }
    throw error;
  }
});
```

- **Fixed lock order (requester row, then target row) on every call**
  prevents deadlocks between concurrent transfer attempts — the only way two
  transfers can race at all is two calls from the *same* current captain
  (e.g. a double-tap targeting two different teammates), and both lock the
  requester's own row first, so they serialize on that lock rather than
  deadlocking on different rows in different orders.
- Re-checking `requester.isCaptain` **after** acquiring the row lock (not
  trusting a stale JWT-derived assumption) is what closes the race a plain
  two-`UPDATE` script wouldn't: if transfer A already committed and cleared
  the requester's flag, a concurrent transfer B from that same (now
  ex-)captain sees `isCaptain: false` under its own lock and fails with
  `not_team_captain`, rather than racing the unique index.
- `newCaptainPlayerId === requesterId` (a captain "transferring" to
  themselves) is rejected with a dedicated `409
  captain_transfer_target_is_self`, not treated as a silent no-op — a clear
  error rather than a confusing "nothing happened" response, consistent with
  this project's general preference for explicit errors over silent
  mutation-or-no-ops (see the team-chat ADR's identical reasoning for
  rejected sends).
- The target not belonging to `:teamId` gets its own code
  (`captain_transfer_target_not_on_team`), distinct from the requester's own
  `team_mismatch`, so a client error message can say which side of the
  request was wrong.

### Home module

`PlayersService` gains `transferCaptaincy` (it only touches the `Player`
table — no dependency on `Challenge`/`TeamSeasonPot` the way
`WeeklyGoalService` needs). The controller endpoint is a new method on
`WeeklyGoalController` (it already owns every other
`/api/v1/teams/:teamId/...` route), delegating straight to
`PlayersService.transferCaptaincy` — cross-module service calls between a
team-scoped controller and `PlayersService` are already an established
pattern (`TrainingLogsService` already calls into
`WeeklyGoalService.processGoalBonusForLog` from a different module).

## Decision — 2: a non-captain-gated "who's on my team, who's captain" view

**A new endpoint, `GET /api/v1/teams/:teamId/teammates`, open to any team
member (team-membership check only, not captain-gated), returning
`{ playerId, screenName, avatarId, isCaptain }` per player — nothing else.**

### Why a new endpoint instead of opening up the existing `GET .../roster`

The existing roster endpoint (`docs/api/phase2-contract.md` endpoint 2)
returns `consentStatus` and `lastTrainedDate` per player — data about
*other kids' families* that endpoint 2's own contract note already
justifies keeping captain-only ("a reasonable thing to keep restricted to
the one player-role with a legitimate 'keep an eye on the team' purpose").
Fas 2.6a's ask — "see the entire team and who is captain" — is a much
narrower, non-sensitive need (screen name, avatar, and a boolean flag; the
same category of data every player-facing surface already shows about
teammates). Broadening endpoint 2 itself to every player would leak consent
status team-wide, which is a real regression against the existing,
already-reviewed boundary — not something to do quietly as a side effect of
this feature. A second, narrower endpoint keeps both invariants intact:
consent detail stays captain-only; "who's on the team, who's captain"
becomes visible to everyone, which is what was actually asked for.

`isCaptain` is also added to each entry of the *existing* (still
captain-gated) roster endpoint's response — additive, non-breaking, and
means a captain doesn't need a second call to confirm their own status
either.

### What's deliberately not exposed here

No `consentStatus`, no `lastTrainedDate`, no `realName`/`parentContact`
(the last pair is structurally impossible anyway —
`PlayersService.listByTeam`, which this reuses, never touches
`PlayerPrivateInfo`). If a future feature needs more per-teammate detail
surfaced broadly, that's a fresh, explicit decision, not something to bolt
onto this endpoint's response later without noticing it's crossing the same
boundary endpoint 2 was designed to hold.

## Consequences

- No schema change. `is_captain` and its partial unique index are unchanged
  from ADR-0005 — this ADR only adds a transactional write path and two new
  read paths against existing columns.
- Two new exceptions (`CaptainTransferToSelfException`,
  `CaptainTransferTargetNotOnTeamException`), one new defensive-backstop
  exception (`CaptainTransferConflictException`) for the unreachable-in-
  practice unique-violation case, following this codebase's existing
  `AppException` pattern exactly.
- `PlayersService.transferCaptaincy` and the new `teammates` read path are
  the only new logic; no new module, no new guard class, per ADR-0005's
  already-established "service-layer check, not a `CaptainGuard`" precedent.
- **Not designed here, flagged for security-reviewer**: a captain who has
  just handed off captaincy immediately loses access to the still-existing
  captain-gated actions (roster/consent-reminder/session-reissue/weekly-goal
  management) the instant this transaction commits — this is the intended,
  correct behavior (the flag is the sole source of truth, re-checked on
  every call), not a gap, but worth an explicit confirmation during review
  that no client-side cached "I am captain" state can act as if the check
  still passed after a transfer.
- **Open product question, not decided here**: should the outgoing captain
  or the new captain get any in-app notification that a transfer happened
  (e.g. "Du är nu lagets kapten!")? Nothing in ACTION_PLAN's Fas 2.6a wording
  asks for this, and it's a UX/copy decision, not an architecture one —
  flagged for ux-designer's flow pass, not silently decided by omission
  here. The endpoint's own `200` response is authoritative for the caller;
  whether the *new* captain gets any push/in-app signal on their next open
  (versus just discovering it next time they load the dashboard, where
  `viewerIsCaptain` will now read `true`) is theirs to design.
