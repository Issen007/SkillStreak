import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { ErasureSuccessorRow } from './ErasureSuccessorRow';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import type { TeammateEntry } from '../../api/types';

interface ErasureSuccessorScreenProps {
  loading: boolean;
  errorText: string | null;
  onRetry: () => void;
  /** Already excludes the requester's own row (Judgment call 4 — unlike
   * K4's disabled "(Du)" row, there's no ambiguity worth showing here). */
  teammates: TeammateEntry[];
  selectedPlayerId: string | null;
  onSelect: (teammate: TeammateEntry) => void;
  onDone: () => void;
  onCancel: () => void;
}

/** Screen E3 — "Vem tar över som kapten?", reached from E2's variant A
 * only. Refetches the teammates list fresh on every entry rather than
 * trusting E2's copy (same reasoning K4 already established — staleness
 * here would mean showing an out-of-date roster on the one screen whose
 * whole job is picking a valid target). Picking is the action itself, no
 * separate confirm sheet on this screen — nothing happens server-side
 * until E4's request is actually submitted (Decision 4: the successor is
 * locked in at confirm time, applied at execution time). */
export function ErasureSuccessorScreen({
  loading,
  errorText,
  onRetry,
  teammates,
  selectedPlayerId,
  onSelect,
  onDone,
  onCancel,
}: ErasureSuccessorScreenProps) {
  const { t } = useTranslation('home');

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.flame} size="large" />
      </View>
    );
  }

  if (errorText) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{errorText}</Text>
        <Text style={styles.retryText} onPress={onRetry}>
          {t('shared.retry')}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>{t('erasureSuccessor.heading')}</Text>
        <Text style={styles.sub}>{t('erasureSuccessor.sub')}</Text>

        <View style={styles.list}>
          {teammates.map((teammate) => (
            <ErasureSuccessorRow
              key={teammate.playerId}
              screenName={teammate.screenName}
              avatarId={teammate.avatarId}
              selected={teammate.playerId === selectedPlayerId}
              onPress={() => onSelect(teammate)}
            />
          ))}
        </View>

        <View style={styles.spacer} />
        <PrimaryButton label={t('erasureSuccessor.done')} onPress={onDone} disabled={!selectedPlayerId} />
        <SecondaryLink label={t('shared.cancel')} onPress={onCancel} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 32,
    gap: 10,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 20,
    color: colors.ink,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.textMuted,
    lineHeight: 17,
  },
  list: {
    gap: 8,
  },
  spacer: {
    height: 8,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
    textAlign: 'center',
  },
  retryText: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.ink,
    textDecorationLine: 'underline',
  },
});
