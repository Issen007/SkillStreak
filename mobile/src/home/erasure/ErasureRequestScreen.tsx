import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DangerButton } from '../../components/DangerButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { AVATAR_CATALOG } from '../../onboarding/avatarCatalog';

interface ErasureRequestScreenProps {
  loading: boolean;
  errorText: string | null;
  onRetry: () => void;
  viewerIsCaptain: boolean;
  /** Other players on the team, not counting the requester themselves. */
  teammateCount: number;
  successorScreenName: string | null;
  successorAvatarId: string | null;
  onChooseSuccessor: () => void;
  onSubmit: () => void;
  onCancel: () => void;
}

/** Screen E2 — "Radera ditt konto?" Fetches the same two calls K1/K4 make
 * (`GET .../dashboard` for `viewerIsCaptain`, `GET .../teammates` for the
 * roster count) rather than a new read — see the flow doc's note that
 * `ProfileScreen` needed `teamId` plumbed in for this. No API call happens
 * on this screen's own primary-button tap (Decision 3) — E4's sheet does
 * the real call. */
export function ErasureRequestScreen({
  loading,
  errorText,
  onRetry,
  viewerIsCaptain,
  teammateCount,
  successorScreenName,
  successorAvatarId,
  onChooseSuccessor,
  onSubmit,
  onCancel,
}: ErasureRequestScreenProps) {
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.flame} size="large" />
      </View>
    );
  }

  // "If either fetch fails, this screen shows a plain retry-only error
  // state... rather than guessing" — silently treating a failed fetch as
  // "not captain" would risk skipping Decision 4's mandatory successor
  // step for a captain who really does have one.
  if (errorText) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{errorText}</Text>
        <Text style={styles.retryText} onPress={onRetry}>
          Försök igen
        </Text>
      </View>
    );
  }

  const isLastPlayer = viewerIsCaptain && teammateCount === 0;
  const requiresSuccessor = viewerIsCaptain && teammateCount > 0;
  const successorEmoji = successorAvatarId
    ? AVATAR_CATALOG.find((a) => a.avatarId === successorAvatarId)?.emoji ?? '🙂'
    : null;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Radera ditt konto?</Text>

        <View style={styles.bullets}>
          <Text style={styles.bullet}>
            •  All din träningshistorik, dina märken och dina klipp raderas för alltid.
          </Text>
          <Text style={styles.bullet}>
            •  Du försvinner från laget. Dina meddelanden i lagchatten blir anonyma — laget och
            lagkompisarna påverkas inte annars.
          </Text>
          <Text style={styles.bullet}>•  Det går inte att ångra så fort de 30 dagarna har gått.</Text>
        </View>

        <View style={styles.tipRow}>
          <Text style={styles.tipText}>
            ℹ️ Vi skickar ett mejl som du (eller en förälder eller vårdnadshavare) måste bekräfta —
            bara att trycka på knappen här nedan gör ingenting än. Så fort mejlet är bekräftat har
            du 30 dagar på dig att ångra dig, och kontot funkar precis som vanligt under tiden.
          </Text>
        </View>

        {requiresSuccessor ? (
          <View style={styles.captainBox}>
            <Text style={styles.captainBoxTitle}>👑 Du är lagets kapten</Text>
            <Text style={styles.captainBoxBody}>
              Du måste välja vem som tar över som kapten innan du kan gå vidare.
            </Text>
            <View style={styles.successorRow}>
              {successorScreenName ? (
                <>
                  <View style={styles.successorAvatar}>
                    <Text style={styles.successorAvatarEmoji}>{successorEmoji}</Text>
                  </View>
                  <Text style={styles.successorName}>{successorScreenName}</Text>
                </>
              ) : (
                <Text style={styles.successorMuted}>Ingen vald än</Text>
              )}
              <SecondaryLink
                label={successorScreenName ? 'Ändra' : 'Välj'}
                onPress={onChooseSuccessor}
              />
            </View>
          </View>
        ) : isLastPlayer ? (
          <View style={styles.warnRow}>
            <Text style={styles.warnText}>
              Just nu är du ensam kvar i laget. Om det fortfarande stämmer om 30 dagar försvinner
              hela laget när ditt konto raderas — poäng, klipp och allt annat.
            </Text>
          </View>
        ) : null}

        <View style={styles.spacer} />
        <DangerButton
          label="Radera mitt konto"
          onPress={onSubmit}
          disabled={requiresSuccessor && !successorScreenName}
        />
        <SecondaryLink label="Avbryt" onPress={onCancel} />
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
    gap: 14,
  },
  spacer: {
    height: 6,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 22,
    color: colors.ink,
  },
  bullets: {
    gap: 8,
  },
  bullet: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textBody,
    lineHeight: 19,
  },
  tipRow: {
    backgroundColor: colors.tipBg,
    borderWidth: 1,
    borderColor: colors.tipBorder,
    borderRadius: 14,
    padding: 12,
  },
  tipText: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.textBody,
    lineHeight: 18,
  },
  warnRow: {
    backgroundColor: colors.pausedBg,
    borderWidth: 1,
    borderColor: colors.pausedBorder,
    borderRadius: 14,
    padding: 12,
  },
  warnText: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.textBody,
    lineHeight: 18,
  },
  captainBox: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.white,
    padding: 14,
    gap: 8,
  },
  captainBoxTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
    color: colors.ink,
  },
  captainBoxBody: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.textMuted,
    lineHeight: 17,
  },
  successorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  successorAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.flameTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successorAvatarEmoji: {
    fontSize: 14,
  },
  successorName: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.ink,
  },
  successorMuted: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
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
