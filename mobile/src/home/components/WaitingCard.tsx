import { Pressable, StyleSheet, Text, View } from 'react-native';

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
  const isPaused = consentStatus === 'revoked';
  const consentPending = consentStatus !== 'approved' && !isPaused;
  const joinPending = teamJoinStatus === 'pending';

  function pendingTitle(): string {
    if (consentPending && joinPending) return 'Väntar på godkännande';
    if (joinPending) return 'Väntar på lagets kapten';
    return isSelfVerification ? 'Väntar på att du verifierar' : 'Väntar på godkännande';
  }

  function pendingBody(): string {
    const consentPart = isSelfVerification
      ? 'Vi har skickat en verifieringslänk till din e-post eller ditt mobilnummer.'
      : 'Vi har frågat en förälder eller vårdnadshavare om lov.';
    const joinPart = 'Lagets kapten behöver godkänna att du gick med i laget.';
    if (consentPending && joinPending) {
      return `${consentPart} ${joinPart} Så fort båda är klara låser vi upp knappen nedan!`;
    }
    if (joinPending) {
      return `${joinPart} Så fort kaptenen godkänner låser vi upp knappen nedan!`;
    }
    return `${consentPart} Så fort det är klart låser vi upp knappen nedan!`;
  }

  return (
    <View style={[styles.card, isPaused ? styles.cardPaused : styles.cardPending]}>
      <View style={styles.headRow}>
        <Text style={styles.icon}>{isPaused ? '⏸️' : '⏳'}</Text>
        <Text style={styles.title}>
          {isPaused ? 'Träning är pausad just nu' : pendingTitle()}
        </Text>
      </View>
      <Text style={styles.body}>
        {isPaused
          ? 'En förälder eller vårdnadshavare har dragit tillbaka godkännandet. Prata med din tränare om du har frågor.'
          : pendingBody()}
      </Text>
      {!isPaused ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRefresh}
          disabled={refreshing}
          style={({ pressed }) => [styles.refreshButton, pressed && styles.refreshPressed]}
        >
          <Text style={styles.refreshText}>{refreshing ? 'Kollar...' : 'Kolla igen'}</Text>
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
