import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { BadgeTriggerReason } from '../badge-trigger-reason.enum';

// Discriminated union for BadgeAward.context, per docs/adr/0002-data-model.md
// addendum §3. No badge-award endpoint exists yet in Phase 1 — this DTO is
// the enforced boundary shape ready for whichever module writes BadgeAward
// rows in Phase 2/3. It intentionally has no `location`/`address`/
// coordinate-shaped field in any variant, and none should be added without
// a fresh ADR (per the addendum).
//
// class-validator doesn't have first-class discriminated-union support, so
// each variant is validated explicitly and the caller is expected to pick
// the right class via `triggerReason` (e.g. a small factory/switch) before
// validating — see badge-award-context.dto.spec.ts for the intended usage.

export class StreakMilestoneContext {
  @IsIn([BadgeTriggerReason.STREAK_MILESTONE])
  triggerReason!: BadgeTriggerReason.STREAK_MILESTONE;

  @IsInt()
  @Min(1)
  streakCount!: number;
}

export class ChallengeCompletedContext {
  @IsIn([BadgeTriggerReason.CHALLENGE_COMPLETED])
  triggerReason!: BadgeTriggerReason.CHALLENGE_COMPLETED;

  @IsUUID()
  challengeId!: string;
}

export class TeamPoolMilestoneContext {
  @IsIn([BadgeTriggerReason.TEAM_POOL_MILESTONE])
  triggerReason!: BadgeTriggerReason.TEAM_POOL_MILESTONE;

  @IsUUID()
  teamSeasonPotId!: string;

  @IsNumber()
  @Min(0)
  percentComplete!: number;
}

export class CoachManualAwardContext {
  @IsIn([BadgeTriggerReason.COACH_MANUAL_AWARD])
  triggerReason!: BadgeTriggerReason.COACH_MANUAL_AWARD;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  note?: string;
}

export class EffortNominationContext {
  @IsIn([BadgeTriggerReason.EFFORT_NOMINATION])
  triggerReason!: BadgeTriggerReason.EFFORT_NOMINATION;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  note?: string;
}

export type BadgeAwardContext =
  | StreakMilestoneContext
  | ChallengeCompletedContext
  | TeamPoolMilestoneContext
  | CoachManualAwardContext
  | EffortNominationContext;

export const BADGE_AWARD_CONTEXT_CLASS_BY_REASON: Record<
  BadgeTriggerReason,
  new () => BadgeAwardContext
> = {
  [BadgeTriggerReason.STREAK_MILESTONE]: StreakMilestoneContext,
  [BadgeTriggerReason.CHALLENGE_COMPLETED]: ChallengeCompletedContext,
  [BadgeTriggerReason.TEAM_POOL_MILESTONE]: TeamPoolMilestoneContext,
  [BadgeTriggerReason.COACH_MANUAL_AWARD]: CoachManualAwardContext,
  [BadgeTriggerReason.EFFORT_NOMINATION]: EffortNominationContext,
};
