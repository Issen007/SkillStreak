import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '../../components/ScreenContainer';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface O1aTeamNotFoundProps {
  inviteCode: string;
  /** Card A — "I probably typed it wrong". Sends the player back to O1
   * with the code pre-filled and selected. */
  onWrongCode: () => void;
  /** Card B — "our team doesn't have a code yet". Starts the create-a-team
   * branch (Screen O1b). */
  onCreateTeam: () => void;
}

/** Screen O1a (docs/design/phase1-flows.md's 2026-07-09 update) — replaces
 * O1's old dead-end inline 404 error. Built as a full navigated screen, not
 * an inline panel under O1's input (the flow doc's judgment call #8/#9):
 * two big, equal-weight cards read more clearly to this age group than an
 * inline error competing with the input above it. Neither card is styled
 * as "primary" — the UI shouldn't nudge a kid toward creating a team just
 * because that option looks more inviting. */
export function O1aTeamNotFound({
  inviteCode,
  onWrongCode,
  onCreateTeam,
}: O1aTeamNotFoundProps) {
  return (
    <ScreenContainer scroll>
      <View style={styles.spacerTop} />
      <Text style={styles.heading}>
        Vi hittade inget lag med koden <Text style={styles.codeChip}>{inviteCode}</Text>
      </Text>
      <Text style={styles.sub}>Ingen fara — välj det som stämmer för dig:</Text>

      <Pressable
        accessibilityRole="button"
        onPress={onWrongCode}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      >
        <Text style={styles.cardIcon}>🔍</Text>
        <View style={styles.cardText}>
          <Text style={styles.cardTitle}>Jag skrev nog fel</Text>
          <Text style={styles.cardSub}>Testa koden igen</Text>
        </View>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={onCreateTeam}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      >
        <Text style={styles.cardIcon}>✨</Text>
        <View style={styles.cardText}>
          <Text style={styles.cardTitle}>Vårt lag har ingen kod än</Text>
          <Text style={styles.cardSub}>Skapa ett nytt lag med den här koden</Text>
        </View>
      </Pressable>

      <View style={styles.spacer} />

      <Text style={styles.helper}>
        Osäker? Fråga din tränare innan du skapar ett nytt lag.
      </Text>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  spacerTop: { height: 24 },
  spacer: { flex: 1, minHeight: 8 },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 22,
    color: colors.ink,
    textAlign: 'center',
    lineHeight: 30,
  },
  codeChip: {
    // Nested `Text` spans don't reliably support `borderRadius`/`padding`
    // in React Native (unlike a standalone `View`-wrapped chip elsewhere in
    // this flow) — `backgroundColor` on its own still reads clearly as "the
    // code that didn't match" without a broken/clipped rounded corner.
    fontFamily: 'Courier New',
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.border,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 15,
    backgroundColor: colors.white,
  },
  cardPressed: {
    opacity: 0.75,
  },
  cardIcon: {
    fontSize: 26,
  },
  cardText: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    fontFamily: fonts.headingBold,
    fontSize: 16,
    color: colors.ink,
  },
  cardSub: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.textMuted,
  },
  helper: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
