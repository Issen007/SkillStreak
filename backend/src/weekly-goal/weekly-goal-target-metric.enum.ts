import { ActivityType } from '../training-logs/activity-type.enum';

// The fixed preset from docs/design/phase2-flows.md's CB2 / ADR-0005
// Decision 2, widened from 5 to 10 values by
// docs/adr/0015-weekly-goal-per-player-completion.md Decision 1 (each
// `-minuter` value gets a `-pass` ("träningspass"/session) counterpart) —
// validated at the DTO boundary
// (create-weekly-goal.dto.ts/update-weekly-goal.dto.ts), same pattern as
// BadgeAwardContext.triggerReason. Challenge.target_metric itself stays a
// plain varchar column (unchanged from Phase 1), not a DB enum — so
// widening the accepted value set is a pure application-level change, no
// migration, and the 5 pre-existing values keep meaning exactly what they
// meant before.
export enum WeeklyGoalTargetMetric {
  FITNESS_MINUTER = 'fitness-minuter',
  DRILL_MINUTER = 'drill-minuter',
  RUNNING_MINUTER = 'running-minuter',
  OTHER_MINUTER = 'other-minuter',
  TOTAL_MINUTER = 'total-minuter',
  FITNESS_PASS = 'fitness-pass',
  DRILL_PASS = 'drill-pass',
  RUNNING_PASS = 'running-pass',
  OTHER_PASS = 'other-pass',
  TOTAL_PASS = 'total-pass',
}

// ADR-0015 Decision 1 — which unit a per-player progress computation sums
// (`SUM(duration_minutes)`) vs. counts (`COUNT(*)` of qualifying
// TrainingLogEntry rows — sessions, not distinct days: two separate
// sessions logged the same day count as two). Every one of the 10 values
// above is self-consistent by construction (the unit is encoded in the
// value itself), so there's nothing to cross-validate here.
export const TARGET_UNIT_BY_TARGET_METRIC: Record<
  WeeklyGoalTargetMetric,
  'minutes' | 'sessions'
> = {
  [WeeklyGoalTargetMetric.FITNESS_MINUTER]: 'minutes',
  [WeeklyGoalTargetMetric.DRILL_MINUTER]: 'minutes',
  [WeeklyGoalTargetMetric.RUNNING_MINUTER]: 'minutes',
  [WeeklyGoalTargetMetric.OTHER_MINUTER]: 'minutes',
  [WeeklyGoalTargetMetric.TOTAL_MINUTER]: 'minutes',
  [WeeklyGoalTargetMetric.FITNESS_PASS]: 'sessions',
  [WeeklyGoalTargetMetric.DRILL_PASS]: 'sessions',
  [WeeklyGoalTargetMetric.RUNNING_PASS]: 'sessions',
  [WeeklyGoalTargetMetric.OTHER_PASS]: 'sessions',
  [WeeklyGoalTargetMetric.TOTAL_PASS]: 'sessions',
};

// ADR-0005 Decision 2's progress formula, extended by ADR-0015 Decision 1:
// every metric except total-minuter/total-pass (which count every logged
// minute/session regardless of activity) maps 1:1 onto an ActivityType
// filter — each `*_PASS` value maps to the same ActivityType as its
// `*_MINUTER` counterpart.
export const ACTIVITY_TYPE_BY_TARGET_METRIC: Partial<
  Record<WeeklyGoalTargetMetric, ActivityType>
> = {
  [WeeklyGoalTargetMetric.FITNESS_MINUTER]: ActivityType.FITNESS,
  [WeeklyGoalTargetMetric.DRILL_MINUTER]: ActivityType.DRILL,
  [WeeklyGoalTargetMetric.RUNNING_MINUTER]: ActivityType.RUNNING,
  [WeeklyGoalTargetMetric.OTHER_MINUTER]: ActivityType.OTHER,
  [WeeklyGoalTargetMetric.FITNESS_PASS]: ActivityType.FITNESS,
  [WeeklyGoalTargetMetric.DRILL_PASS]: ActivityType.DRILL,
  [WeeklyGoalTargetMetric.RUNNING_PASS]: ActivityType.RUNNING,
  [WeeklyGoalTargetMetric.OTHER_PASS]: ActivityType.OTHER,
};
