import type { WeeklyGoalTargetMetric } from '../api/types';

/** The goal builder's (KB1-KB4) accumulated client-side form state — mirrors
 * `OnboardingData`'s role in onboarding/types.ts. Submitted whole at KB4. */
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
  value: WeeklyGoalTargetMetric;
  icon: string;
  label: string;
}

/** The fixed five-value `targetMetric` preset, per docs/design/
 * phase2-flows.md Screen KB2 / ADR-0005 Decision 2 — progress can only be
 * computed automatically from logged minutes, never a free-text move
 * count. */
export const TARGET_METRIC_OPTIONS: TargetMetricOption[] = [
  { value: 'fitness-minuter', icon: '🏋️', label: 'Kondition' },
  { value: 'drill-minuter', icon: '🏑', label: 'Teknik/övning' },
  { value: 'running-minuter', icon: '🏃', label: 'Löpning' },
  { value: 'other-minuter', icon: '⭐', label: 'Annat' },
  { value: 'total-minuter', icon: '🎯', label: 'Totalt (alla typer)' },
];

export function targetMetricLabel(metric: WeeklyGoalTargetMetric): string {
  return TARGET_METRIC_OPTIONS.find((option) => option.value === metric)?.label ?? metric;
}
