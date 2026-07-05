import { useState } from 'react';

import { KB1TitleDescription } from './screens/KB1TitleDescription';
import { KB2TargetMetric } from './screens/KB2TargetMetric';
import { KB3Dates } from './screens/KB3Dates';
import { KB4Review } from './screens/KB4Review';
import { GoalBuilderData, GoalBuilderStep } from './types';
import { createWeeklyGoal, patchWeeklyGoal } from '../api/endpoints';
import { ApiError } from '../api/ApiError';
import { addDaysIsoDate, todayIsoDate } from '../utils/dateMath';
import type { EditableGoalFields } from '../api/types';

interface GoalBuilderFlowProps {
  teamId: string;
  /** Set when editing an existing `draft` (KB1-KB3 pre-filled, per the flow
   * doc) — its `id` also drives PATCH instead of POST at KB4. */
  existingGoal?: EditableGoalFields | null;
  /** Whether a *different* goal is currently `active` on this team — drives
   * KB4's preemptive "Aktivera nu" disable guard. */
  hasActiveGoal: boolean;
  onDone: (message: string) => void;
  onCancel: () => void;
}

/** Screens KB1-KB4 — the weekly-goal builder, modeled as a small step state
 * machine (same "not a navigation library" posture as OnboardingFlow). */
export function GoalBuilderFlow({
  teamId,
  existingGoal,
  hasActiveGoal,
  onDone,
  onCancel,
}: GoalBuilderFlowProps) {
  const [step, setStep] = useState<GoalBuilderStep>('KB1');
  const [data, setData] = useState<GoalBuilderData>(() => ({
    title: existingGoal?.title ?? '',
    description: existingGoal?.description ?? '',
    targetMetric: existingGoal?.targetMetric ?? null,
    targetValue: existingGoal?.targetValue ?? null,
    startDate: existingGoal?.startDate ?? todayIsoDate(),
    endDate: existingGoal?.endDate ?? addDaysIsoDate(todayIsoDate(), 7),
  }));

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [serverBlockedActivate, setServerBlockedActivate] = useState(false);

  const handleSubmit = async (status: 'draft' | 'active') => {
    if (data.targetMetric === null || data.targetValue === null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (existingGoal) {
        // PATCH's `status` field only ever accepts `active`/`completed`/
        // `cancelled` (per the contract — you can't PATCH a goal back to
        // `draft`), so "Spara som utkast" while editing an already-`draft`
        // goal omits `status` entirely (no transition needed, it's already
        // `draft`); only "Aktivera nu" ever sends one.
        await patchWeeklyGoal(teamId, existingGoal.id, {
          title: data.title,
          description: data.description,
          targetMetric: data.targetMetric,
          targetValue: data.targetValue,
          startDate: data.startDate,
          endDate: data.endDate,
          ...(status === 'active' ? { status: 'active' as const } : {}),
        });
      } else {
        await createWeeklyGoal(teamId, {
          title: data.title,
          description: data.description,
          targetMetric: data.targetMetric,
          targetValue: data.targetValue,
          startDate: data.startDate,
          endDate: data.endDate,
          status,
        });
      }
      onDone(status === 'active' ? 'Målet är aktiverat — laget ser det nu.' : 'Målet är sparat!');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'active_goal_already_exists') {
        // Fallback error state per the flow doc: re-fetching happens in
        // GoalScreen once onDone/onCancel returns there; here we just show
        // the same inline explanation KB4's preemptive guard already uses.
        setServerBlockedActivate(true);
      } else {
        setSubmitError('Något gick fel. Testa igen.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  switch (step) {
    case 'KB1':
      return (
        <KB1TitleDescription
          initialTitle={data.title}
          initialDescription={data.description}
          onNext={(title, description) => {
            setData((prev) => ({ ...prev, title, description }));
            setStep('KB2');
          }}
          onCancel={onCancel}
        />
      );

    case 'KB2':
      return (
        <KB2TargetMetric
          initialTargetMetric={data.targetMetric}
          initialTargetValue={data.targetValue}
          onNext={(targetMetric, targetValue) => {
            setData((prev) => ({ ...prev, targetMetric, targetValue }));
            setStep('KB3');
          }}
          onBack={() => setStep('KB1')}
        />
      );

    case 'KB3':
      return (
        <KB3Dates
          initialStartDate={data.startDate}
          initialEndDate={data.endDate}
          onNext={(startDate, endDate) => {
            setData((prev) => ({ ...prev, startDate, endDate }));
            setStep('KB4');
          }}
          onBack={() => setStep('KB2')}
        />
      );

    case 'KB4':
      return (
        <KB4Review
          data={data}
          submitting={submitting}
          errorText={submitError}
          activateBlockedByServer={serverBlockedActivate}
          activateBlockedLocally={hasActiveGoal}
          onSaveDraft={() => void handleSubmit('draft')}
          onActivate={() => void handleSubmit('active')}
          onBack={() => setStep('KB3')}
        />
      );

    default:
      return null;
  }
}
