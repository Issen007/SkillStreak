import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { ScreenContainer } from '../../components/ScreenContainer';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { TextField } from '../../components/TextField';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface O1bNameTeamProps {
  inviteCode: string;
  initialTeamName: string;
  /** Set when arriving here after a 422 team_name_rejected_by_filter from
   * O5's final submit. */
  externalError?: string | null;
  /** True after the 422 case, or after O1c's "Nej, ändra namnet" — pre-
   * focuses the name field. */
  focusNameOnMount?: boolean;
  onNext: (teamName: string) => void;
  /** "Byt kod" — back to Screen O1, code pre-filled and editable (not
   * selected, unlike O1a's "Jag skrev nog fel" card — this is a deliberate
   * code change, not a typo fix). */
  onChangeCode: () => void;
}

/** Screen O1b (docs/design/phase1-flows.md's 2026-07-09 update) — team
 * naming step for the self-service create path. Reached from O1a's "Vårt
 * lag har ingen kod än" card. */
export function O1bNameTeam({
  inviteCode,
  initialTeamName,
  externalError,
  focusNameOnMount,
  onNext,
  onChangeCode,
}: O1bNameTeamProps) {
  const [teamName, setTeamName] = useState(initialTeamName);
  const [error, setError] = useState<string | null>(externalError ?? null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (focusNameOnMount) {
      // Give the screen a beat to mount before focusing, same pattern as
      // O3's 409 recovery.
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [focusNameOnMount]);

  return (
    <ScreenContainer scroll>
      <View style={styles.spacerTop} />

      <View style={styles.codeRow}>
        <Text style={styles.codeChip}>Lagkod: {inviteCode}</Text>
        <SecondaryLink label="Byt kod" onPress={onChangeCode} />
      </View>

      <Text style={styles.heading}>Vad ska ert lag heta?</Text>
      <Text style={styles.sub}>
        Du blir lagets första spelare — och kapten! Välj ett namn som resten
        av laget kan vara stolta över.
      </Text>

      <TextField
        ref={inputRef}
        label="Lagnamn"
        value={teamName}
        onChangeText={(text) => {
          setTeamName(text);
          if (error) setError(null);
        }}
        placeholder="T.ex. IBK Falken P13"
        autoCorrect={false}
        autoComplete="off"
        errorText={error ?? undefined}
      />
      <Text style={styles.helper}>Andra lag kan se namnet på topplistan.</Text>

      <View style={styles.spacer} />

      <PrimaryButton
        label="Nästa"
        disabled={teamName.trim().length === 0}
        onPress={() => onNext(teamName.trim())}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  spacerTop: { height: 8 },
  spacer: { flex: 1, minHeight: 16 },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  codeChip: {
    fontFamily: 'Courier New',
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.ink,
    backgroundColor: colors.border,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 22,
    color: colors.ink,
    textAlign: 'center',
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.textBody,
    textAlign: 'center',
    lineHeight: 19,
  },
  helper: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
