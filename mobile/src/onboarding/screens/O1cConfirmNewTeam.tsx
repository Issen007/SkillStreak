import { StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '../../components/ScreenContainer';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface O1cConfirmNewTeamProps {
  teamName: string;
  inviteCode: string;
  onConfirm: () => void;
  /** "Nej, ändra namnet" — back to Screen O1b, name field pre-filled and
   * focused. */
  onEditName: () => void;
}

/** Screen O1c (docs/design/phase1-flows.md's 2026-07-09 update) — the
 * create-path confirmation gate ADR-0009 flagged as missing ("Flagged —
 * adjacent risks" item 4), mirroring where Screen O2 sits relative to
 * O3-O5 for the join path. No API call happens here — per ADR-0009
 * Decision 1, the team itself isn't created until the final
 * `POST /players` succeeds at the end of O5; this screen only locks in the
 * kid's stated intent. */
export function O1cConfirmNewTeam({
  teamName,
  inviteCode,
  onConfirm,
  onEditName,
}: O1cConfirmNewTeamProps) {
  return (
    <ScreenContainer>
      <View style={styles.spacerTop} />
      <Text style={styles.icon}>🏒</Text>
      <Text style={styles.heading}>Skapa {teamName}?</Text>
      <Text style={styles.sub}>
        Lagkod: {inviteCode} — dela den med lagkompisar så de kan gå med
        sen.
      </Text>

      <View style={styles.tipRow}>
        <Text style={styles.tipIcon}>💡</Text>
        <Text style={styles.tipText}>
          Namnet och koden går inte att ändra sen, så dubbelkolla att allt
          stämmer!
        </Text>
      </View>

      <View style={styles.spacer} />

      <PrimaryButton label="Ja, skapa laget!" onPress={onConfirm} />
      <SecondaryLink label="Nej, ändra namnet" onPress={onEditName} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  spacerTop: { height: 24 },
  spacer: { flex: 1, minHeight: 24 },
  icon: {
    fontSize: 40,
    textAlign: 'center',
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 24,
    color: colors.ink,
    textAlign: 'center',
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
  tipRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: colors.tipBg,
    borderWidth: 1.5,
    borderColor: colors.tipBorder,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  tipIcon: {
    fontSize: 16,
  },
  tipText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.textBody,
    lineHeight: 18,
  },
});
