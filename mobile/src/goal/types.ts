import type { TFunction } from 'i18next';

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

/** The `t` function every caller passes in — exactly `useTranslation('goal').t`'s
 * type, so every call site here type-checks against the same typed-resource
 * augmentation (`react-i18next.d.ts`) the rest of the app uses. */
type GoalT = TFunction<'goal'>;

/** Narrow literal-key types for just the two small lookup tables below,
 * rather than widening to every key in the `goal` namespace (a union that
 * mixes plain keys with interpolated ones, which trips up `TFunction`'s
 * overload resolution when a single call site's key type spans both). Each
 * of these five/two values genuinely exists under `metricLabel`/
 * `metricLabelInline`/`unitLabel` in every locale's `goal.json`. */
type MetricKeyLeaf = 'fitness' | 'drill' | 'running' | 'other' | 'total';
type MetricLabelKey = `metricLabel.${MetricKeyLeaf}`;
type MetricLabelInlineKey = `metricLabelInline.${MetricKeyLeaf}`;
type UnitLabelKey = 'unitLabel.minutes' | 'unitLabel.sessions';

interface TargetMetricOption {
  icon: string;
  /** Title-case chip/label copy (`goal.json`'s `metricLabel.*`) — used
   * standalone (chip text, GoalCard's metric chip). */
  labelKey: MetricLabelKey;
  /** Lowercase/inline copy (`goal.json`'s `metricLabelInline.*`) — used only
   * mid-sentence (KB2's live preview line), kept as a *separate* translated
   * key rather than a runtime `.toLowerCase()` of `labelKey`: some of the 8
   * supported languages (German nouns, in particular) can't be lowercased
   * mid-sentence the way Swedish/English can, so each language's JSON
   * supplies whatever casing is actually grammatical for that context. */
  labelInlineKey: MetricLabelInlineKey;
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
 * one value each. Icons are universal (not translated); `labelKey`/
 * `labelInlineKey` point into the `goal` namespace's `metricLabel`/
 * `metricLabelInline` objects. */
export const TARGET_METRIC_OPTIONS: TargetMetricOption[] = [
  {
    icon: '🏋️',
    labelKey: 'metricLabel.fitness',
    labelInlineKey: 'metricLabelInline.fitness',
    minutesValue: 'fitness-minuter',
    sessionsValue: 'fitness-pass',
  },
  {
    icon: '🏑',
    labelKey: 'metricLabel.drill',
    labelInlineKey: 'metricLabelInline.drill',
    minutesValue: 'drill-minuter',
    sessionsValue: 'drill-pass',
  },
  {
    icon: '🏃',
    labelKey: 'metricLabel.running',
    labelInlineKey: 'metricLabelInline.running',
    minutesValue: 'running-minuter',
    sessionsValue: 'running-pass',
  },
  {
    icon: '⭐',
    labelKey: 'metricLabel.other',
    labelInlineKey: 'metricLabelInline.other',
    minutesValue: 'other-minuter',
    sessionsValue: 'other-pass',
  },
  {
    icon: '🎯',
    labelKey: 'metricLabel.total',
    labelInlineKey: 'metricLabelInline.total',
    minutesValue: 'total-minuter',
    sessionsValue: 'total-pass',
  },
];

function findOption(metric: WeeklyGoalTargetMetric): TargetMetricOption | undefined {
  return TARGET_METRIC_OPTIONS.find(
    (option) => option.minutesValue === metric || option.sessionsValue === metric,
  );
}

export function targetMetricLabel(t: GoalT, metric: WeeklyGoalTargetMetric): string {
  const option = findOption(metric);
  return option ? t(option.labelKey) : metric;
}

/** Mid-sentence variant — see `TargetMetricOption.labelInlineKey`'s comment
 * for why this isn't just `targetMetricLabel(...).toLowerCase()`. */
export function targetMetricLabelInline(t: GoalT, metric: WeeklyGoalTargetMetric): string {
  const option = findOption(metric);
  return option ? t(option.labelInlineKey) : metric;
}

export function targetMetricIcon(metric: WeeklyGoalTargetMetric): string {
  return findOption(metric)?.icon ?? '🎯';
}

/** `targetUnitLabel`/`targetMetricLabel` share one small lookup, per the
 * flow doc's note to keep it next to `TARGET_METRIC_OPTIONS` rather than a
 * second source of truth for metric/unit copy. Points into `goal.json`'s
 * `unitLabel` object — kept translatable since "pass" happens to be
 * gender/number-invariant in Swedish but that won't generally hold. */
const TARGET_UNIT_LABEL_KEYS = {
  minutes: 'unitLabel.minutes',
  sessions: 'unitLabel.sessions',
} as const satisfies Record<WeeklyGoalTargetUnit, UnitLabelKey>;

export function targetUnitLabel(t: GoalT, unit: WeeklyGoalTargetUnit): string {
  return t(TARGET_UNIT_LABEL_KEYS[unit]);
}

/** Every `-pass` value maps to `'sessions'`, every `-minuter` value maps to
 * `'minutes'` — mirrors ADR-0015 Decision 1's suffix convention. Only
 * needed client-side inside the goal builder (KB2/KB4), before a goal
 * exists to fetch `targetUnit` from; once a goal is loaded from the API,
 * always prefer its own `targetUnit` field over re-deriving this. */
export function targetUnitForMetric(metric: WeeklyGoalTargetMetric): WeeklyGoalTargetUnit {
  return metric.endsWith('-pass') ? 'sessions' : 'minutes';
}
