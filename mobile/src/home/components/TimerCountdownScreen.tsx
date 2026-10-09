import { useEffect, useState } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from '../../components/PrimaryButton';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { evidencePointsPreview } from '../../api/types';
import { elapsedWholeMinutes, remainingMs } from '../../api/trainingTimer';
import type { ActiveTimer } from '../../api/trainingTimer';

/** What a finished timer can be logged with — ADR-0038 Decision 5: the
 * timer fixes the minutes, an attached clip sets the tier. */
export type TimerLogChoice = 'timer' | 'video' | 'video_shared';

const FINISH_OPTIONS = [
  { choice: 'timer', labelKey: 'trainingTimer.evidenceTimer' },
  { choice: 'video', labelKey: 'activitySheet.evidence.video' },
  { choice: 'video_shared', labelKey: 'activitySheet.evidence.videoShared' },
] as const satisfies readonly { choice: TimerLogChoice; labelKey: string }[];

interface TimerCountdownScreenProps {
  visible: boolean;
  timer: ActiveTimer;
  loading: boolean;
  errorText: string | null;
  onLog: (minutesDone: number, choice: TimerLogChoice) => void;
  onDiscard: () => void;
}

function formatClock(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * docs/adr/0038 — the countdown for the ×1 timer tier.
 *
 * The number on screen is recomputed from the server's `endsAt` on every
 * tick and whenever the app returns to the foreground. It is never a
 * counter decremented on the phone, so backgrounding, a locked screen, or
 * the app being killed and reopened all show the right time.
 *
 * Stopping early is always allowed and always pays the whole minutes done
 * (Decision 3): stopping because something hurts must never cost a child
 * their points. Under one minute there is nothing the server would accept,
 * so the screen says so instead of sending a log that would fail.
 */
export function TimerCountdownScreen({
  visible,
  timer,
  loading,
  errorText,
  onLog,
  onDiscard,
}: TimerCountdownScreenProps) {
  const { t } = useTranslation('home');
  // Only used to force a re-render; the real values come from the clock.
  const [, setTick] = useState(0);
  const [phase, setPhase] = useState<'running' | 'confirmStop' | 'finish'>('running');
  const [finishMinutes, setFinishMinutes] = useState(0);
  const [choice, setChoice] = useState<TimerLogChoice>('timer');

  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => setTick((n) => n + 1), 500);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setTick((n) => n + 1);
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [visible]);

  // A different timer (e.g. restored after a relaunch) starts fresh.
  useEffect(() => {
    setPhase('running');
    setChoice('timer');
  }, [timer.timerId]);

  const remaining = remainingMs(timer);
  const isDone = remaining <= 0;
  const minutesSoFar = elapsedWholeMinutes(timer);
  const activityLabel = t(`activitySheet.activities.${timer.activityType}`);

  const goToFinish = (minutes: number) => {
    setFinishMinutes(minutes);
    setPhase('finish');
  };

  const handleBack = () => {
    if (loading) return;
    if (phase !== 'running') setPhase('running');
  };

  // Always reachable once the child has asked to stop: this screen covers
  // the whole app, so there must be a way out that does not require logging.
  const discardButton = (
    <Pressable
      accessibilityRole="button"
      disabled={loading}
      onPress={onDiscard}
      style={styles.secondaryButton}
    >
      <Text style={styles.secondaryLabel}>{t('trainingTimer.discard')}</Text>
    </Pressable>
  );

  let content;
  if (phase === 'finish') {
    content = (
      <>
        <Text style={styles.heading}>{t('trainingTimer.finishHeading')}</Text>
        <Text style={styles.body}>
          {t('trainingTimer.finishHelp', { minutes: finishMinutes })}
        </Text>
        {FINISH_OPTIONS.map((option) => {
          const selected = option.choice === choice;
          return (
            <Pressable
              key={option.choice}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setChoice(option.choice)}
              style={[styles.optionRow, selected && styles.optionRowSelected]}
            >
              <Text style={styles.optionLabel}>{t(option.labelKey)}</Text>
              <Text style={styles.optionPoints}>
                {t('activitySheet.evidencePoints', {
                  count: evidencePointsPreview(finishMinutes, option.choice),
                })}
              </Text>
            </Pressable>
          );
        })}
        <PrimaryButton
          label={t('trainingTimer.submit')}
          loading={loading}
          onPress={() => onLog(finishMinutes, choice)}
        />
        <Pressable
          accessibilityRole="button"
          onPress={handleBack}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryLabel}>{t('trainingTimer.back')}</Text>
        </Pressable>
        {discardButton}
      </>
    );
  } else if (isDone) {
    content = (
      <>
        <Text style={styles.heading}>{t('trainingTimer.doneHeading')}</Text>
        <Text style={styles.body}>
          {t('trainingTimer.doneBody', { minutes: timer.plannedMinutes })}
        </Text>
        <PrimaryButton
          label={t('trainingTimer.logIt')}
          onPress={() => goToFinish(timer.plannedMinutes)}
        />
      </>
    );
  } else if (phase === 'confirmStop') {
    content =
      minutesSoFar < 1 ? (
        <>
          <Text style={styles.body}>{t('trainingTimer.tooShort')}</Text>
          <PrimaryButton
            label={t('trainingTimer.keepGoing')}
            onPress={() => setPhase('running')}
          />
          {discardButton}
        </>
      ) : (
        <>
          <Text style={styles.body}>
            {t('trainingTimer.stopConfirm', { minutes: minutesSoFar })}
          </Text>
          <PrimaryButton
            label={t('trainingTimer.stopConfirmYes')}
            onPress={() => goToFinish(minutesSoFar)}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => setPhase('running')}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryLabel}>{t('trainingTimer.keepGoing')}</Text>
          </Pressable>
          {discardButton}
        </>
      );
  } else {
    content = (
      <>
        <Text style={styles.heading}>{t('trainingTimer.heading')}</Text>
        <Text style={styles.body}>{t('trainingTimer.explainer')}</Text>
        <PrimaryButton label={t('trainingTimer.stop')} onPress={() => setPhase('confirmStop')} />
      </>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleBack}>
      <View style={styles.screen}>
        <View style={styles.clockBlock}>
          <Text style={styles.activity}>{activityLabel}</Text>
          <Text
            style={styles.clock}
            accessibilityRole="timer"
            accessibilityLabel={t('trainingTimer.remainingA11y', {
              time: formatClock(remaining),
            })}
          >
            {formatClock(remaining)}
          </Text>
          <Text style={styles.ofMinutes}>
            {t('trainingTimer.ofMinutes', { minutes: timer.plannedMinutes })}
          </Text>
        </View>
        <View style={styles.actions}>
          {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
          {content}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.paper,
    paddingTop: 64,
    paddingHorizontal: 22,
    paddingBottom: 32,
    justifyContent: 'space-between',
  },
  clockBlock: {
    alignItems: 'center',
    marginTop: 24,
    gap: 4,
  },
  activity: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.textMuted,
  },
  clock: {
    fontFamily: fonts.headingBold,
    fontSize: 84,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  ofMinutes: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.textMuted,
  },
  actions: {
    gap: 12,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 20,
    color: colors.ink,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.textBody,
    textAlign: 'center',
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  optionRowSelected: {
    borderColor: colors.flame,
    backgroundColor: colors.pendingBg,
  },
  optionLabel: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
  },
  optionPoints: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.ink,
  },
  secondaryButton: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.textMuted,
  },
  error: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.error,
    textAlign: 'center',
  },
});
