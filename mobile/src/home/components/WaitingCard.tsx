import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import type { ConsentStatus, TeamJoinStatus } from '../../api/types';

interface WaitingCardProps {
  /** Only ever rendered when at least one gate below isn't clear (the
   * caller branches on that already); typed as the full enum rather than
   * an `Omit` so the caller doesn't need an unsafe cast at the call site. */
  consentStatus: ConsentStatus;
  /** Age-banded self-verification (13+) — added 2026-07-27. Only changes
   * the "pending" copy (waiting for a parent vs. waiting for the player's
   * own email click); `revoked` is a later, separate admin/captain action
   * unrelated to who originally verified, so its copy is unchanged. */
  isSelfVerification: boolean;
  /** Added 2026-07-27 — a second, independent gate alongside
   * consentStatus (captain approval of the team join itself). Both are
   * shown together if both are still pending, since they're unrelated
   * blockers a player needs to know about separately. */
  teamJoinStatus: TeamJoinStatus;
  onRefresh: () => void;
  refreshing: boolean;
}

/** Screen O7 / State H4 — per docs/design/phase1-flows.md, `not_requested`
 * and `pending` share one "waiting" copy variant (the distinction is a
 * backend/audit concern, not a player-facing one); `revoked` gets its own
 * "paused" variant with no guilt-trip framing and no manual refresh
 * button (nothing a re-check would change until a coach re-enables it).
 * `revoked` takes priority over a still-pending team-join status — an
 * actively revoked consent is the more urgent thing to communicate. */
export function WaitingCard({
  consentStatus,
  isSelfVerification,
  teamJoinStatus,
  onRefresh,
  refreshing,
}: WaitingCardProps) {
  const { t } = useTranslation('home');
  const isPaused = consentStatus === 'revoked';
  const consentPending = consentStatus !== 'approved' && !isPaused;
  const joinPending = teamJoinStatus === 'pending';

  function pendingTitle(): string {
    if (consentPending && joinPending) return t('waitingCard.titleBothPending');
    if (joinPending) return t('waitingCard.titleJoinPending');
    return isSelfVerification
      ? t('waitingCard.titleSelfVerificationPending')
      : t('waitingCard.titleConsentPending');
  }

  function pendingBody(): string {
    const consentPart = isSelfVerification
      ? t('waitingCard.consentPartSelfVerification')
      : t('waitingCard.consentPartParent');
    const joinPart = t('waitingCard.joinPart');
    if (consentPending && joinPending) {
      return `${consentPart} ${joinPart} ${t('waitingCard.suffixBoth')}`;
    }
    if (joinPending) {
      return `${joinPart} ${t('waitingCard.suffixJoinOnly')}`;
    }
    return `${consentPart} ${t('waitingCard.suffixConsentOnly')}`;
  }

  return (
    <View style={[styles.card, isPaused ? styles.cardPaused : styles.cardPending]}>
      <View style={styles.headRow}>
        <Text style={styles.icon}>{isPaused ? '⏸️' : '⏳'}</Text>
        <Text style={styles.title}>
          {isPaused ? t('waitingCard.titlePaused') : pendingTitle()}
        </Text>
      </View>
      <Text style={styles.body}>
        {isPaused ? t('waitingCard.pausedBody') : pendingBody()}
      </Text>
      {!isPaused ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRefresh}
          disabled={refreshing}
          style={({ pressed }) => [styles.refreshButton, pressed && styles.refreshPressed]}
        >
          <Text style={styles.refreshText}>
            {refreshing ? t('waitingCard.refreshing') : t('waitingCard.refresh')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 18,
    gap: 8,
  },
  cardPending: {
    backgroundColor: colors.pendingBg,
    borderColor: colors.pendingBorder,
  },
  cardPaused: {
    backgroundColor: colors.pausedBg,
    borderColor: colors.pausedBorder,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  icon: {
    fontSize: 20,
  },
  title: {
    fontFamily: fonts.headingBold,
    fontSize: 15,
    color: colors.ink,
    flexShrink: 1,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textBody,
    lineHeight: 17,
  },
  refreshButton: {
    alignSelf: 'flex-start',
    marginTop: 2,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  refreshPressed: {
    opacity: 0.6,
  },
  refreshText: {
    fontFamily: fonts.bodyBold,
    fontSize: 11.5,
    color: colors.ink,
  },
});
