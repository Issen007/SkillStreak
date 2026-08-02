import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { formatSwedishDateWithYear } from '../../utils/formatDate';
import type { ErasureStatus } from '../../api/types';

interface ErasureStatusCardProps {
  status: Extract<ErasureStatus, 'requested' | 'grace_period'>;
  scheduledFor?: string;
  successorScreenName?: string;
  onCancel: () => void;
  cancelling: boolean;
}

/** Screen E6 — the persistent Profile-screen status card, shown inline on
 * Profile's `view` step whenever `GET /players/me/erasure/status` returns
 * anything other than `'none'` (see the flow doc). Reuses `WaitingCard`'s
 * exact visual language (`pendingBg`/`pendingBorder`, ⏳ icon, card shape)
 * rather than inventing a third "waiting" style — this is a persistent
 * bordered card, not an auto-dismissing `Toast`, because this state needs
 * to still be visible the next time the screen is opened.
 *
 * Both variants deliberately reuse the same calm ⏳ icon (Judgment call
 * 7) — ADR Decision 7's "nothing about the account is restricted... no
 * guilt" — the copy carries the seriousness, not the color/iconography.
 *
 * Note: `successorScreenName` is only ever present once `GET
 * .../erasure/status` reports `grace_period` *and* a still-valid
 * successor was actually locked in at confirm time — a captain's
 * originally-named successor can be silently cleared back to null at
 * confirm time if they'd since left the team or gone mid-erasure
 * themselves (Decision 4's execution-time auto-fallback is what actually
 * resolves "no still-valid successor," not this card), so omitting the
 * line entirely in that case is correct, not a bug. */
export function ErasureStatusCard({
  status,
  scheduledFor,
  successorScreenName,
  onCancel,
  cancelling,
}: ErasureStatusCardProps) {
  const { t } = useTranslation('home');
  const isGracePeriod = status === 'grace_period';
  const title = isGracePeriod
    ? t('erasureStatusCard.titleGracePeriod', {
        date: scheduledFor
          ? formatSwedishDateWithYear(scheduledFor)
          : t('erasureStatusCard.unknownDate'),
      })
    : t('erasureStatusCard.titleRequested');
  const body = isGracePeriod
    ? [
        t('erasureStatusCard.gracePeriodBody'),
        successorScreenName
          ? t('erasureStatusCard.gracePeriodSuccessor', { successorScreenName })
          : null,
      ]
        .filter(Boolean)
        .join(' ')
    : t('erasureStatusCard.requestedBody');
  const actionLabel = isGracePeriod
    ? t('erasureStatusCard.cancelGracePeriod')
    : t('erasureStatusCard.cancelRequested');

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Text style={styles.icon}>⏳</Text>
        <Text style={styles.title}>{title}</Text>
      </View>
      <Text style={styles.body}>{body}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: cancelling }}
        onPress={cancelling ? undefined : onCancel}
        style={({ pressed }) => [styles.action, pressed && !cancelling && styles.actionPressed]}
      >
        <Text style={styles.actionText}>
          {cancelling ? t('erasureStatusCard.cancelling') : actionLabel}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.pendingBg,
    borderWidth: 1.5,
    borderColor: colors.pendingBorder,
    borderRadius: 20,
    padding: 16,
    gap: 8,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  icon: {
    fontSize: 19,
  },
  title: {
    flex: 1,
    fontFamily: fonts.headingBold,
    fontSize: 14.5,
    color: colors.ink,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textBody,
    lineHeight: 17,
  },
  action: {
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  actionPressed: {
    opacity: 0.6,
  },
  actionText: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.textMuted,
  },
});
