# ADR-0038 — A countdown-timer points tier, and a weekly cap on click-only logs

## Status

Accepted, 2026-10-09. Requested by the project owner:

> *"x0.1 if they just click and report. This should only be able to be used
> 3 times every week. x1.2 if they recording live … x1.4 if they also share
> the content. But we should also have a new function x1 if they just start
> a clock that count down. If they want to do 30 min training a clock will
> start count down for 30 min. When that is done they go (min x 1) points."*

×0.1, ×1.2 and ×1.4 already exist (ADR-0025, tiers 1, 3 and 4). This ADR
adds two things: a **timer tier at ×1**, and a **cap of 3 paid click-only
logs per week**. The three questions this ADR could not settle were
answered by the owner the same day: Decisions 3, 4 and 5.

Amends ADR-0025. Its tier 5 (public sharing, ×2) is untouched and stays
unbuilt: "share" here means sharing with the team, exactly as tier 4 does
today.

## Decision 1 — the timer takes the ×1 slot, and the selfie tier stays reserved

ADR-0025 reserved ×1 for a selfie tier that was never built, because a
photo of a child carries the full privacy weight of a video with none of
its machinery. A countdown timer earns the same ×1 with **no media at
all**: no camera, no upload, nothing of the child leaves the device. It is
the cheapest real step up from a bare tap.

New `EvidenceTier.TIMED` = ×1. `SELFIE` stays defined and unreachable.

## Decision 2 — the server keeps the clock

A timer that lives only on the phone is a tap with extra steps: nothing
would stop a client claiming a finished 30-minute timer after five seconds.

- `POST /api/v1/training-timers` `{activityType, plannedMinutes}` creates a
  timer row with a **server** `startedAt` and returns
  `{timerId, startedAt, plannedMinutes, endsAt}`. Same consent and
  team-join checks as logging. Starting a new timer abandons any unused
  one for that player; there is at most one open timer.
- `POST /api/v1/training-logs` gains optional `timerId`. The credited
  duration is `min(durationMinutes, plannedMinutes, whole minutes elapsed
  since startedAt)`. Under one elapsed minute is rejected.
- A timer verifies one log, then is consumed. A timer older than 24 hours
  is unusable.

The app shows the countdown from `endsAt`, so it survives the app being
backgrounded or killed; the end is announced with a local notification.

**What this does not claim**: that the child trained while the clock ran.
It proves time passed between starting and logging, which is more than a
tap and less than a video. The copy must not overstate it.

## Decision 3 — stopping early pays the minutes done, at ×1 (owner)

20 minutes into a 30-minute timer, stopping pays 20 × 1. Stopping because
something hurts must never cost a child their points; ADR-0025's
"a session that happened is worth something" applies.

## Decision 4 — the 4th click-only log in a week still logs, for 0 points (owner)

A click-only log (no timer, no clip) pays ×0.1 for the player's first 3 in
a week (Monday–Sunday, Europe/Stockholm — the weekly-goal week). From the
4th, the log is still saved and **still counts for the streak and for
weekly-goal minutes and sessions**, but earns **0 points**. This is the one
exception to ADR-0025's floor of 1.

Blocking the log entirely was rejected: a child who trained without the
app open would lose their streak to a points rule, which punishes the
training the app exists to encourage.

The count is taken inside the logging transaction, after the player row
lock, so two concurrent taps cannot both be the 3rd. The allowance is
visible before the choice (ADR-0025 Decision 1): `GET
/api/v1/training-logs/click-only-allowance` returns
`{used, limit, resetsOn}`.

## Decision 5 — timer and video combine; the highest tier wins (owner)

A timed session may also attach a clip. The timer fixes the minutes; the
clip sets the tier (×1.2 or ×1.4). Multipliers are never added together.
A log stores its timer id as well as its tier, so both remain auditable.

## Consequences

- Logging response gains `pointsAwarded` and `clickOnlyAllowance`, so the
  app can say "0 points — you've used your 3 quick logs this week, try the
  timer" instead of a silent zero.
- Migration: new `training_timer` table; `training_log_entry.timer_id`
  (nullable, unique); enum value `timed` added to
  `training_log_evidence_tier_enum`.
- No location of any kind is recorded by the timer. It records *that* a
  clock ran, never *where*.
- Existing logs are not re-rated.
