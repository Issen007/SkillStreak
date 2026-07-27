import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import type { ConsentStatus } from '../../api/types';

interface ClipsWaitingCardProps {
  consentStatus: ConsentStatus;
  /** Age-banded self-verification (13+) — added 2026-07-27, same
   * reasoning as WaitingCard's identical prop. */
  isSelfVerification: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}

/** Screen V1 — the consent-gated *whole-tab* state, not just a disabled
 * upload button. Per the contract's explicit divergence from chat: `GET
 * .../clips` itself returns `403 consent_required` for a non-`approved`
 * player, so this occupies the entire Klipp tab — mirrors `WaitingCard`'s
 * exact three-variant shape (O7/H4) but with its own copy, since there's no
 * team-pool-card equivalent to leave visible underneath here (nothing else
 * lives on this tab). Deliberately its own small component, not a reuse of
 * `WaitingCard` — that component's copy is specific to the "Jag har
 * tränat" button context ("låser vi upp knappen nedan"), which doesn't fit
 * a tab with no button below it. */
export function ClipsWaitingCard({
  consentStatus,
  isSelfVerification,
  onRefresh,
  refreshing,
}: ClipsWaitingCardProps) {
  const isPaused = consentStatus === 'revoked';

  return (
    <View style={[styles.card, isPaused ? styles.cardPaused : styles.cardPending]}>
      <Text style={styles.icon}>{isPaused ? '⏸️' : '⏳'}</Text>
      <Text style={styles.title}>
        {isPaused
          ? 'Shorts är pausat just nu'
          : isSelfVerification
            ? 'Väntar på att du verifierar'
            : 'Väntar på godkännande'}
      </Text>
      <Text style={styles.body}>
        {isPaused
          ? 'En förälder eller vårdnadshavare har dragit tillbaka godkännandet. Prata med din tränare om du har frågor.'
          : isSelfVerification
            ? 'Du behöver verifiera din e-post eller ditt mobilnummer innan du kan se eller ladda upp Shorts. Så fort du klickar på länken vi skickade låser vi upp Shorts-fliken.'
            : 'En förälder eller vårdnadshavare behöver säga ja innan du kan se eller ladda upp Shorts. Så fort de godkänner låser vi upp Shorts-fliken.'}
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
    marginTop: 40,
    marginHorizontal: 24,
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 20,
    gap: 8,
    alignItems: 'center',
  },
  cardPending: {
    backgroundColor: colors.pendingBg,
    borderColor: colors.pendingBorder,
  },
  cardPaused: {
    backgroundColor: colors.pausedBg,
    borderColor: colors.pausedBorder,
  },
  icon: {
    fontSize: 34,
  },
  title: {
    fontFamily: fonts.headingBold,
    fontSize: 17,
    color: colors.ink,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textBody,
    lineHeight: 18,
    textAlign: 'center',
  },
  refreshButton: {
    marginTop: 4,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  refreshPressed: {
    opacity: 0.6,
  },
  refreshText: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: colors.ink,
  },
});
