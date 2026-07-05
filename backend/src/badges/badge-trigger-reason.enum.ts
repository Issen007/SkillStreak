// No badge-award endpoint exists yet (dormant since Phase 1, still dormant
// after Phase 2 — see badge-award-context.dto.ts's file comment).
// COACH_MANUAL_AWARD predates Phase 2's kapten pivot and assumes an
// authenticated adult coach identity to attribute the award to; that
// identity doesn't currently exist (see
// src/coaches/entities/coach.entity.ts's comment) — whoever builds the
// real award endpoint needs to either reintroduce coach auth or re-scope
// this reason (e.g. to the captain) before it's reachable.
export enum BadgeTriggerReason {
  STREAK_MILESTONE = 'streak_milestone',
  CHALLENGE_COMPLETED = 'challenge_completed',
  TEAM_POOL_MILESTONE = 'team_pool_milestone',
  COACH_MANUAL_AWARD = 'coach_manual_award',
  EFFORT_NOMINATION = 'effort_nomination',
}
