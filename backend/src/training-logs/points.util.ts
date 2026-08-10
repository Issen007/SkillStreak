/**
 * Evidence tier for one training log — docs/adr/0025-evidence-tiered-
 * training-points.md.
 *
 * Stored on the row rather than recomputed, so a log's tier stays auditable
 * after the fact even if the clip it referenced has since been deleted
 * (deleting a clip never claws points back — see the ADR's Consequences).
 *
 * SELFIE is defined but deliberately not reachable yet: the app has no
 * photo capture anywhere, and a photo of a child's face carries the same
 * privacy weight as a video while inheriting none of the video pipeline's
 * EXIF-stripping, retention or reporting machinery. Deferred to its own
 * pass (ADR-0025 Decision 5). The value is reserved here so the stored
 * numbers never have to be renumbered when it lands.
 */
export enum EvidenceTier {
  /** Today's mechanism: a tap, no evidence of any kind. */
  CLICK_ONLY = 'click_only',
  /** Reserved, not yet reachable — see above. */
  SELFIE = 'selfie',
  /** A real clip attached to the session. */
  VIDEO = 'video',
  /** A clip attached and shared with the team. */
  VIDEO_SHARED_WITH_TEAM = 'video_shared_with_team',
}

/**
 * The multipliers, **literal, exactly as the project owner specified**
 * (confirmed 2026-08-10 with a worked example: a 3x20-minute week logged as
 * one public share, one photo and one bare report pays 40 + 20 + 2 = 62).
 *
 * These were briefly re-based to x1/x10/x12/x14 on 2026-08-09, on two
 * arguments. One of them — that ADR-0005's weekly-goal thresholds would
 * need retuning — **was wrong**: weekly goals count minutes or sessions
 * (WeeklyGoalTargetMetric's `*-minuter`/`*-pass` split, ADR-0015) and have
 * never read points at all. The other argument stands and is now an
 * accepted cost: an unproven session drops from 60 points to 6, a real
 * devaluation of the only mechanism the app has ever had, chosen knowingly
 * so that proof is what earns.
 *
 * What IS points-based, and does move with this: `TeamSeasonPot
 * .goalThreshold` (the VM-Guld pot target, ADR-0008). Retuning it is a
 * separate, live task — see ADR-0025's open questions.
 */
const MULTIPLIER_BY_TIER: Record<EvidenceTier, number> = {
  [EvidenceTier.CLICK_ONLY]: 0.1,
  [EvidenceTier.SELFIE]: 1,
  [EvidenceTier.VIDEO]: 1.2,
  [EvidenceTier.VIDEO_SHARED_WITH_TEAM]: 1.4,
};

/**
 * Fractional multipliers mean fractional products — 15 minutes x 0.1 is
 * 1.5 — and team points must stay whole: they land in
 * TeamSeasonPot.pointsTotal and are read by children off a leaderboard.
 *
 * Round to nearest, floor of 1 (owner's choice, 2026-08-10). The floor is
 * the part that matters: without it a 5-minute unproven session pays zero,
 * and "you trained and got nothing" is a worse message for a 9-year-old
 * than any rounding inaccuracy. A session that happened is always worth
 * something.
 */
function toWholePoints(raw: number): number {
  return Math.max(1, Math.round(raw));
}

/**
 * Points for one training log.
 *
 * The Phase 1 comment this replaces called the flat per-minute rate "an
 * explicit assumption to confirm with the architect/coach" and noted it was
 * never revisited when ADR-0005 built the weekly-goal bonus on top of it.
 * ADR-0025 is that revisit: the rate is still per-minute, now scaled by what
 * the player actually offered as proof.
 *
 * **An unproven session is now worth a tenth of what it was.** ADR-0008's
 * VM-Guld pot threshold is tuned against the old numbers and needs
 * retuning; ADR-0005's weekly goals do NOT — they count minutes and
 * sessions, never points.
 */
export function pointsForTrainingLog(
  durationMinutes: number,
  tier: EvidenceTier = EvidenceTier.CLICK_ONLY,
): number {
  return toWholePoints(durationMinutes * MULTIPLIER_BY_TIER[tier]);
}

/** Exposed so the client can show what each option is worth *before* the
 * player chooses — ADR-0025 Decision 1 is explicit that the multiplier has
 * to be visible ahead of the choice, not applied after it. */
export function evidenceMultiplier(tier: EvidenceTier): number {
  return MULTIPLIER_BY_TIER[tier];
}
