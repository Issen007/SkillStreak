import { ActivityType } from '../training-logs/activity-type.enum';

// The fixed 5-value preset from docs/design/phase2-flows.md's CB2 / ADR-0005
// Decision 2 — validated at the DTO boundary
// (create-weekly-goal.dto.ts/update-weekly-goal.dto.ts), same pattern as
// BadgeAwardContext.triggerReason. Challenge.target_metric itself stays a
// plain varchar column (unchanged from Phase 1), not a DB enum.
export enum WeeklyGoalTargetMetric {
  FITNESS_MINUTER = 'fitness-minuter',
  DRILL_MINUTER = 'drill-minuter',
  RUNNING_MINUTER = 'running-minuter',
  OTHER_MINUTER = 'other-minuter',
  TOTAL_MINUTER = 'total-minuter',
}

// ADR-0005 Decision 2's progress formula: every metric except
// total-minuter (which counts every logged minute regardless of activity)
// maps 1:1 onto an ActivityType filter.
export const ACTIVITY_TYPE_BY_TARGET_METRIC: Partial<
  Record<WeeklyGoalTargetMetric, ActivityType>
> = {
  [WeeklyGoalTargetMetric.FITNESS_MINUTER]: ActivityType.FITNESS,
  [WeeklyGoalTargetMetric.DRILL_MINUTER]: ActivityType.DRILL,
  [WeeklyGoalTargetMetric.RUNNING_MINUTER]: ActivityType.RUNNING,
  [WeeklyGoalTargetMetric.OTHER_MINUTER]: ActivityType.OTHER,
};
