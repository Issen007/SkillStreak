import type { WeeklyGoalTargetMetric, WeeklyGoalTargetUnit } from '../api/types';

/** The goal builder's (KB1-KB4) accumulated client-side form state — mirrors
 * `OnboardingData`'s role in onboarding/types.ts. Submitted whole at KB4.
 * `targetMetric` already encodes the chosen unit (ADR-0015 Decision 1's
 * 10-value enum, `-minuter` vs `-pass`), so no separate unit field is
 * needed here. */
export interface GoalBuilderData {
  title: string;
  description: string;
  targetMetric: WeeklyGoalTargetMetric | null;
  targetValue: number | null;
  startDate: string;
  endDate: string;
}

export type GoalBuilderStep = 'KB1' | 'KB2' | 'KB3' | 'KB4';

interface TargetMetricOption {
  icon: string;
  label: string;
  /** The `-minuter` value submitted when "⏱️ Minuter" is selected. */
  minutesValue: WeeklyGoalTargetMetric;
  /** The `-pass` value submitted when "🔁 Antal pass" is selected. */
  sessionsValue: WeeklyGoalTargetMetric;
}

/** The fixed five activity-type chips, per docs/design/
 * phase2.10-per-player-goal-flows.md Screen KB2 / ADR-0015 Decision 1 —
 * progress can only be computed automatically from logged minutes/session
 * counts, never a free-text move count. Each chip now maps to one of two
 * `WeeklyGoalTargetMetric` values depending on the unit toggle, rather than
 * one value each. */
export const TARGET_METRIC_OPTIONS: TargetMetricOption[] = [
  { icon: '🏋️', label: 'Kondition', minutesValue: 'fitness-minuter', sessionsValue: 'fitness-pass' },
  { icon: '🏑', label: 'Teknik/övning', minutesValue: 'drill-minuter', sessionsValue: 'drill-pass' },
  { icon: '🏃', label: 'Löpning', minutesValue: 'running-minuter', sessionsValue: 'running-pass' },
  { icon: '⭐', label: 'Annat', minutesValue: 'other-minuter', sessionsValue: 'other-pass' },
  { icon: '🎯', label: 'Totalt (alla typer)', minutesValue: 'total-minuter', sessionsValue: 'total-pass' },
];

export function targetMetricLabel(metric: WeeklyGoalTargetMetric): string {
  return (
    TARGET_METRIC_OPTIONS.find(
      (option) => option.minutesValue === metric || option.sessionsValue === metric,
    )?.label ?? metric
  );
}

export function targetMetricIcon(metric: WeeklyGoalTargetMetric): string {
  return (
    TARGET_METRIC_OPTIONS.find(
      (option) => option.minutesValue === metric || option.sessionsValue === metric,
    )?.icon ?? '🎯'
  );
}

/** `targetUnitLabel`/`targetMetricLabel` share one small lookup, per the
 * flow doc's note to keep it next to `TARGET_METRIC_OPTIONS` rather than a
 * second source of truth for metric/unit copy. Kept translatable (a plain
 * slot, not baked into a template) since "pass" happens to be
 * gender/number-invariant in Swedish but that won't generally hold. */
const TARGET_UNIT_LABELS: Record<WeeklyGoalTargetUnit, string> = {
  minutes: 'minuter',
  sessions: 'pass',
};

export function targetUnitLabel(unit: WeeklyGoalTargetUnit): string {
  return TARGET_UNIT_LABELS[unit];
}

/** Every `-pass` value maps to `'sessions'`, every `-minuter` value maps to
 * `'minutes'` — mirrors ADR-0015 Decision 1's suffix convention. Only
 * needed client-side inside the goal builder (KB2/KB4), before a goal
 * exists to fetch `targetUnit` from; once a goal is loaded from the API,
 * always prefer its own `targetUnit` field over re-deriving this. */
export function targetUnitForMetric(metric: WeeklyGoalTargetMetric): WeeklyGoalTargetUnit {
  return metric.endsWith('-pass') ? 'sessions' : 'minutes';
}
