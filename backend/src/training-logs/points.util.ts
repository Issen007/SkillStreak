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
 * The multipliers, **re-based** from the project owner's spec
 * (click 0.1 / selfie 1 / video 1.2 / shared 1.4) so that no existing
 * behaviour loses value — approved 2026-08-09.
 *
 * Every ratio the owner specified is preserved exactly: a team-shared video
 * is still worth 14× an unverified tap, as 1.4 is to 0.1. What changed is
 * the base point: applying 0.1 literally would have cut today's only
 * mechanism by 90% overnight, so a child who kept doing exactly what the
 * app has rewarded since launch would watch a 60-point session become 6.
 * That is the difference between "new ways to earn more" and "the app took
 * my points away", and this audience is 9-13.
 *
 * Integers, not floats: points land in `TeamSeasonPot.pointsTotal` and are
 * compared against ADR-0005's weekly-goal thresholds, and fractional team
 * points would be both surprising in the UI and a rounding argument nobody
 * needs. The re-basing makes that free — every multiplier is a whole
 * number, so no rounding rule is required at all.
 */
const MULTIPLIER_BY_TIER: Record<EvidenceTier, number> = {
  [EvidenceTier.CLICK_ONLY]: 1,
  [EvidenceTier.SELFIE]: 10,
  [EvidenceTier.VIDEO]: 12,
  [EvidenceTier.VIDEO_SHARED_WITH_TEAM]: 14,
};

/**
 * Points for one training log.
 *
 * The Phase 1 comment this replaces called the flat per-minute rate "an
 * explicit assumption to confirm with the architect/coach" and noted it was
 * never revisited when ADR-0005 built the weekly-goal bonus on top of it.
 * ADR-0025 is that revisit: the rate is still per-minute, now scaled by what
 * the player actually offered as proof.
 *
 * **The absolute scale is 10× what it was.** ADR-0005's goal thresholds and
 * ADR-0008's leaderboard are tuned against the old numbers and move with
 * this — see the ADR's first open question.
 */
export function pointsForTrainingLog(
  durationMinutes: number,
  tier: EvidenceTier = EvidenceTier.CLICK_ONLY,
): number {
  return durationMinutes * MULTIPLIER_BY_TIER[tier];
}

/** Exposed so the client can show what each option is worth *before* the
 * player chooses — ADR-0025 Decision 1 is explicit that the multiplier has
 * to be visible ahead of the choice, not applied after it. */
export function evidenceMultiplier(tier: EvidenceTier): number {
  return MULTIPLIER_BY_TIER[tier];
}
