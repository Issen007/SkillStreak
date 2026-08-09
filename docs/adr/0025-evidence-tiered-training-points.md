# 0025 — Evidence-tiered training points, and the attach-evidence step that makes them possible

## Status

Proposed, 2026-08-09. Supersedes nothing; **changes** the base rate in
`backend/src/training-logs/points.util.ts` that ADR-0005's weekly-goal
bonus formula sits on top of.

**Blocking reviews not yet done**: `security-reviewer` and `ux-designer`,
both named as prerequisites by `docs/internal/BACKLOG.md`'s own entry, on
one specific question — see Decision 4. Do not build Decision 4's top tier
before those land.

## Context

Today `pointsForTrainingLog` returns `durationMinutes`, flat. There is no
verification of any kind: a player can tap "Jag har tränat", claim 60
minutes, and receive 60 team points having done nothing. The project owner
has raised this repeatedly — the app's goal is *actually training more
often*, and an unverified checkbox tap is worth the same as a real session.

The requested shape (BACKLOG.md, 2026-07-27, with concrete multipliers
added 2026-08-05) scales points by **evidence and generosity**:

| Tier | Evidence | Multiplier |
|---|---|---|
| 1 | Click only — today's mechanism | MIN × 0.1 |
| 2 | Selfie | MIN × 1 |
| 3 | Video, not shared | MIN × 1.2 |
| 4 | Video shared with the team | MIN × 1.4 |
| 5 | Video shared publicly | MIN × 2 |

**This ADR exists because logging and uploading are currently two entirely
separate journeys.** `POST /training-logs` accepts `activityType`,
`durationMinutes` and an optional `challengeId` — no media field, no clip
reference — and nothing in the app routes from a completed log toward the
upload flow. There is therefore no mechanism by which a log could *be*
video-verified, whatever the formula says. The attach step is the
prerequisite, which is why it is Decision 1 here rather than a follow-up.

## Decision — 1: evidence is attached at log time, in the same action, not stitched together afterwards

`POST /training-logs` gains an optional `evidenceClipId`. The mobile flow
becomes: pick activity + duration → **choose how to prove it** → log.

Rejected alternative: log first, then offer "want to add a clip?" and
retro-fit the points. It reads as friendlier, and it is worse:

- **The points would change after the fact.** A child would see a number,
  then see it change, which is exactly the shape that feels like the app
  taking something away. The multiplier must be visible *before* the
  choice, not applied after it.
- **It splits one intention into two screens**, and the second one is
  skippable at the moment motivation is already spent.
- It makes the "did this log have evidence" question a race between two
  writes rather than a property of one.

The evidence picker is therefore part of the log action, and shows what
each option is worth **before** the child chooses. Being explicit about the
multiplier is deliberate: the mechanism only changes behaviour if it is
legible, and hiding it would make the reward feel arbitrary.

## Decision — 2: the multipliers ship as given, with one correction — tier 1 is a floor, not a cut

The 2026-08-05 numbers are accepted as the product intent. One change,
and it is not cosmetic:

**Applying MIN × 0.1 to click-only logs devalues today's only mechanism by
90% overnight.** Every current player would watch their per-session points
collapse from 60 to 6 for the exact behaviour the app has rewarded since
launch, having done nothing wrong. That is not a tuning detail; it is the
difference between "new ways to earn more" and "the app took my points
away", and this audience is 9–13.

So the multipliers are **re-based so that no existing behaviour loses
value**, preserving every ratio the owner specified:

| Tier | Evidence | Spec | As shipped |
|---|---|---|---|
| 1 | Click only | × 0.1 | **× 1** (unchanged from today) |
| 2 | Selfie | × 1 | × 10 |
| 3 | Video, not shared | × 1.2 | × 12 |
| 4 | Video shared with team | × 1.4 | × 14 |
| 5 | Video shared publicly | × 2 | × 20 |

The *relative* incentive is identical — a shared video is still worth 20×
an unverified tap, exactly as specified. What changes is that the reward
arrives as gain rather than loss.

**This is a real trade, stated plainly**: it inflates the absolute point
scale tenfold, which affects `TeamSeasonPot` totals, ADR-0008's cross-team
leaderboard, and ADR-0005's weekly-goal thresholds — all of which are
tuned against today's numbers. Either those thresholds scale with it, or
existing goals become trivially easy. **Open question 1.**

If the project owner prefers the literal 0.1 and accepts the devaluation,
that is a legitimate call — it is their product — but it should be made
knowingly rather than arriving as a consequence.

## Decision — 3: "video-verified" means a *completed, retained* clip belonging to this player, and nothing more

The naive reading — any uploaded file counts — is barely stronger than the
honour system it replaces, and would pay 12× for uploading a black frame.

Verification therefore requires the clip to have:

- reached `status = published` via the existing two-phase upload, so it
  passed ADR-0010 Decision 3's technical checks (real size/content-type,
  successful metadata-strip remux);
- the same `uploaderPlayerId` as the training log; and
- been created within a bounded window of the log (recommend 2 hours), so
  a month-old clip cannot be re-attached to today's session.

**What this deliberately does not claim**: that the video shows the
activity. Confirming that needs the AI content-tagging work
(`docs/adr/0018`), which is blocked on a model decision. Until then this is
*proof a real clip was made around the time claimed*, which is materially
stronger than a checkbox and materially weaker than verification. The copy
must not overstate it.

One clip verifies **one** log. Reuse is rejected outright, otherwise a
single video pays out indefinitely.

## Decision — 4: the public-sharing tier is designed here but MUST NOT ship before a blocking security/UX review

Tier 5 pays a child **20× the baseline** for making a video of themselves
public. The backlog entry raised this risk itself and it is the single most
consequential thing in this document:

- It is a direct, quantified, in-app incentive for a 9–13-year-old to
  publish video of themselves — a much stronger pull than Phase 6's plain
  opt-in publish, because it attaches a number.
- It creates **peer pressure by construction**: once one teammate's public
  clips visibly move the team pool faster, not publishing becomes a way of
  letting the team down. The team-pool mechanic that makes this app
  cooperative is precisely what would make that pressure land hardest.
- CLAUDE.md's closed-team-bubble constraint directs every agent here to
  push back on exactly this shape of change.

**Two hard gates, neither of which this ADR can clear:**

1. Tier 5 depends on Phase 6's public feed, which cannot ship until the
   project owner amends CLAUDE.md's non-negotiable themselves (see
   ADR-0019 and ACTION_PLAN.md's blocked list).
2. `security-reviewer` and `ux-designer` must both pass specifically on
   the peer-pressure-to-publish question, as BACKLOG.md already requires.

**Recommendation: ship tiers 1–4 first and leave tier 5 unbuilt.** Tiers
1–4 deliver the owner's actual stated goal — real training and helping
your team beat an unverified tap — without paying children to go public,
and they need no CLAUDE.md amendment. Tier 5 can follow once Phase 6 lands
and the reviews clear.

## Decision — 5: the selfie tier is accepted, but it is a new media type, not a smaller video

The app has **no photo capture anywhere today**. Every piece of media
machinery is video-specific: the presigned upload, the metadata-strip
remux, the retention sweep, the report/hide flow, the moderation posture.
A selfie tier inherits none of it for free and needs its own answers on
storage, EXIF stripping, retention, reporting, and whether a photo of a
child's face is treated exactly as a video is under the parental-consent
gate (it should be).

**Recommendation: defer tier 2 to its own pass** and ship tiers 1, 3 and 4
first — video already has all of the above, built and reviewed. A selfie is
intuitively "lighter" than a video and is in fact a new surface with the
same child-privacy weight. **Open question 2.**

## Consequences

- `pointsForTrainingLog` gains an evidence parameter; its Phase 1 comment
  about being "an explicit assumption to confirm" is finally resolved.
- `TrainingLog` gains a nullable `evidence_clip_id` FK and a stored
  `evidence_tier`, so a log's tier is auditable after the fact rather than
  recomputed from a clip that may since have been deleted.
- Deleting a clip does **not** claw back points already awarded. Retroactive
  removal for a child who deleted a video is punitive and would make
  deletion — a right this app deliberately makes unconditional — feel
  costly.
- ADR-0005's bonus formula and ADR-0008's leaderboard both consume these
  numbers; see Open question 1.

## Open questions for the project owner

1. **Re-base or literal?** Decision 2 preserves every ratio but multiplies
   the absolute scale by 10 so nobody loses points. The alternative is the
   literal ×0.1 and a 90% cut to existing behaviour. If re-based, do the
   weekly-goal thresholds and leaderboard scale with it?
2. **Selfie tier now or later?** It is a new media type with full
   child-privacy weight (Decision 5).
3. **Tier 5 confirmation.** Recommendation is to leave it unbuilt pending
   Phase 6 and both blocking reviews (Decision 4).
4. **Window length** for "the clip belongs to this session" — 2 hours is a
   guess, not a researched number.
