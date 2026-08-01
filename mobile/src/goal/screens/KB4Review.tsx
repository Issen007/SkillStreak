import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { GoalCard } from '../components/GoalCard';
import { ScreenContainer } from '../../components/ScreenContainer';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { targetUnitForMetric, type GoalBuilderData } from '../types';

interface KB4Props {
  data: GoalBuilderData;
  submitting: boolean;
  errorText: string | null;
  /** True once the server has rejected an "Aktivera nu" attempt with `409
   * active_goal_already_exists` — the fallback error state per the flow
   * doc. */
  activateBlockedByServer: boolean;
  /** True when the client's own last-known state already shows a
   * *different* goal as `active` — the preemptive UX guard the flow doc
   * asks for on top of (not instead of) the server-side 409. */
  activateBlockedLocally: boolean;
  onSaveDraft: () => void;
  onActivate: () => void;
  onBack: () => void;
}

/** Screen KB4 — review + publish. Shows the exact card every teammate will
 * see (Screen G1's `GoalCard`, 0% filled) above the two publish actions. */
export function KB4Review({
  data,
  submitting,
  errorText,
  activateBlockedByServer,
  activateBlockedLocally,
  onSaveDraft,
  onActivate,
  onBack,
}: KB4Props) {
  const { t } = useTranslation('goal');
  const activateBlocked = activateBlockedByServer || activateBlockedLocally;

  return (
    <ScreenContainer scroll>
      <Text style={styles.heading}>{t('kb4.heading')}</Text>

      <GoalCard
        title={data.title}
        description={data.description}
        targetMetric={data.targetMetric ?? 'total-minuter'}
        targetUnit={targetUnitForMetric(data.targetMetric ?? 'total-minuter')}
        targetValue={data.targetValue ?? 0}
        eligiblePlayerCount={0}
        completedPlayerCount={0}
        percentComplete={0}
        goalMet={false}
        endDate={data.endDate}
        isPreview
      />

      {errorText ? <Text style={styles.error}>{errorText}</Text> : null}

      <SecondaryButton label={t('kb4.saveDraft')} loading={submitting} onPress={onSaveDraft} />

      {activateBlocked ? (
        <Text style={styles.inlineExplain}>{t('kb4.activateBlockedExplain')}</Text>
      ) : (
        <PrimaryButton label={t('kb4.activateNow')} loading={submitting} onPress={onActivate} />
      )}

      <SecondaryLink label={t('kb4.back')} onPress={onBack} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 21,
    color: colors.ink,
    textAlign: 'center',
  },
  error: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.error,
    textAlign: 'center',
  },
  inlineExplain: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 16,
  },
});
