import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { AVATAR_CATALOG } from '../../onboarding/avatarCatalog';

interface TeammateStatusRowProps {
  screenName: string;
  avatarId: string;
  variant: 'done' | 'in-progress' | 'excluded';
  /** `in-progress` only. */
  progressValue?: number;
  targetValue?: number;
  unitLabel?: string;
  /** `excluded` only — captain-only per ADR-0015 Decision 4. `null`/
   * `undefined` renders a *shorter* row (no caption line at all) rather
   * than a caption-shaped blank, so a non-captain viewer never sees
   * anything that looks like missing data. */
  exclusionCaption?: string | null;
}

/** Screen G1D's row, one of three visual variants per
 * docs/design/phase2.10-per-player-goal-flows.md. Roster order is
 * preserved by the caller — this component never sorts or ranks. */
export function TeammateStatusRow({
  screenName,
  avatarId,
  variant,
  progressValue = 0,
  targetValue = 0,
  unitLabel = '',
  exclusionCaption = null,
}: TeammateStatusRowProps) {
  const { t, i18n } = useTranslation('goal');
  const numberFormatter = new Intl.NumberFormat(i18n.language);
  const emoji = AVATAR_CATALOG.find((a) => a.avatarId === avatarId)?.emoji ?? '🙂';
  const excluded = variant === 'excluded';
  const fillPercent = targetValue > 0 ? Math.min(100, (progressValue / targetValue) * 100) : 0;

  return (
    <View style={styles.row}>
      <View style={[styles.avatarCircle, excluded && styles.avatarDim]}>
        <Text style={styles.avatarEmoji}>{emoji}</Text>
      </View>
      <View style={styles.info}>
        <Text style={[styles.name, excluded && styles.nameMuted]}>{screenName}</Text>

        {variant === 'in-progress' ? (
          <>
            <Text style={styles.statusWord}>
              {progressValue > 0 ? t('teammateStatusRow.inProgress') : t('teammateStatusRow.notStarted')}
            </Text>
            <View style={styles.miniTrack}>
              <View style={[styles.miniFill, { width: `${fillPercent}%` }]} />
            </View>
            <Text style={styles.progressCaption}>
              {t('teammateStatusRow.progressCaption', {
                progress: numberFormatter.format(progressValue),
                target: numberFormatter.format(targetValue),
                unit: unitLabel,
              })}
            </Text>
          </>
        ) : null}

        {excluded && exclusionCaption ? (
          <Text style={styles.exclusionCaption}>{exclusionCaption}</Text>
        ) : null}
      </View>

      {variant === 'done' ? (
        <View style={styles.doneChip}>
          <Text style={styles.doneChipText}>{t('teammateStatusRow.done')}</Text>
        </View>
      ) : null}
      {excluded ? (
        <View style={styles.excludedChip}>
          <Text style={styles.excludedChipText}>{t('teammateStatusRow.excludedChip')}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatarCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.flameTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarDim: {
    opacity: 0.5,
  },
  avatarEmoji: {
    fontSize: 16,
  },
  info: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.ink,
  },
  nameMuted: {
    color: colors.textMuted,
  },
  statusWord: {
    fontFamily: fonts.bodyBold,
    fontSize: 10.5,
    color: colors.textBody,
  },
  miniTrack: {
    width: '100%',
    height: 5,
    borderRadius: 999,
    backgroundColor: '#F0ECE2',
    overflow: 'hidden',
  },
  miniFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.gold,
  },
  progressCaption: {
    fontFamily: fonts.body,
    fontSize: 10.5,
    color: colors.textMuted,
  },
  exclusionCaption: {
    fontFamily: fonts.body,
    fontSize: 10.5,
    color: colors.textMuted,
  },
  doneChip: {
    backgroundColor: '#EAF6EE',
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  doneChipText: {
    fontFamily: fonts.bodyBold,
    fontSize: 10.5,
    color: colors.success,
  },
  excludedChip: {
    backgroundColor: colors.pausedBg,
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  excludedChipText: {
    fontFamily: fonts.bodyBold,
    fontSize: 10.5,
    color: colors.textMuted,
  },
});
