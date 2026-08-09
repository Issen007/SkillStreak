import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ScreenContainer } from '../../components/ScreenContainer';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { TextField } from '../../components/TextField';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface O1aCreateTeamProps {
  inviteCode: string;
  initialTeamName: string;
  /** Set when arriving here after a 422 team_name_rejected_by_filter from
   * O5's final submit. */
  externalError?: string | null;
  focusNameOnMount?: boolean;
  onCreate: (teamName: string) => void;
  /** "Jag skrev nog fel" — back to O1 with the code selected, so retyping
   * replaces it in one gesture. The overwhelmingly likelier case for a
   * 9-year-old who mistyped one character. */
  onWrongCode: () => void;
}

/**
 * Screen O1a — "the team doesn't exist; is it a new one?"
 *
 * **Replaces the former O1a → O1b → O1c sequence (three screens) with one**,
 * from real usability testing: the project owner's 11-year-old tester did
 * not understand the code concept, and asked in their own words for
 * exactly this — *"it should ask direct 'The team doesn't exist, do you
 * want to create a new team?' … and then create the team first and then
 * next page will be create your Player Name."*
 *
 * Three screens to answer one question was the actual problem. The old
 * flow asked "which of these is you?" (O1a), then "what's it called?"
 * (O1b), then "are you sure?" (O1c) — each individually reasonable, and
 * collectively more hops than this age group tracks. Nothing about the
 * data collected changes; only the number of taps to supply it.
 *
 * **The one thing deliberately NOT collapsed away is the warning that the
 * name and code are permanent.** O1c existed to make that explicit before
 * committing, and it is a real safeguard, not ceremony — so it moved onto
 * this screen next to the button that commits, rather than being dropped
 * along with the screen that carried it.
 *
 * The tester's other concrete suggestion — pre-fill the team name with the
 * code — is deliberately *not* implemented: "FALKEN24" is a fine code and
 * a poor team name, and pre-filling it invites a child to accept a name
 * they cannot change later. The code is shown as read-only underneath with
 * the "share this with your teammates" framing they asked for, which is
 * what actually made the concept land.
 */
export function O1aCreateTeam({
  inviteCode,
  initialTeamName,
  externalError,
  focusNameOnMount,
  onCreate,
  onWrongCode,
}: O1aCreateTeamProps) {
  const { t } = useTranslation('onboarding');
  const [teamName, setTeamName] = useState(initialTeamName);
  const [error, setError] = useState<string | null>(externalError ?? null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (focusNameOnMount) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [focusNameOnMount]);

  return (
    <ScreenContainer scroll>
      <View style={styles.spacerTop} />

      <Text style={styles.heading}>{t('o1a.heading', { inviteCode })}</Text>
      <Text style={styles.sub}>{t('o1a.sub')}</Text>

      <TextField
        ref={inputRef}
        label={t('o1a.nameLabel')}
        placeholder={t('o1a.namePlaceholder')}
        value={teamName}
        onChangeText={(value) => {
          setTeamName(value);
          if (error) setError(null);
        }}
        errorText={error ?? undefined}
      />

      {/* The tester's own suggestion, near-verbatim: show the code as a
          read-only box under the name, labelled with what it is FOR. The
          label does the explaining the first screen couldn't. */}
      <View style={styles.codeBox}>
        <Text style={styles.codeLabel}>{t('o1a.codeLabel')}</Text>
        <Text style={styles.codeValue}>{inviteCode}</Text>
      </View>

      <View style={styles.tipRow}>
        <Text style={styles.tipIcon}>💡</Text>
        <Text style={styles.tipText}>{t('o1a.permanentTip')}</Text>
      </View>

      <PrimaryButton
        label={t('o1a.createButton')}
        disabled={teamName.trim().length === 0}
        onPress={() => onCreate(teamName.trim())}
      />
      <SecondaryLink label={t('o1a.wrongCode')} onPress={onWrongCode} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  spacerTop: { height: 8 },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 22,
    lineHeight: 28,
    color: colors.ink,
    marginBottom: 6,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 14.5,
    lineHeight: 20,
    color: colors.textBody,
    marginBottom: 18,
  },
  codeBox: {
    backgroundColor: colors.pausedBg,
    borderWidth: 1,
    borderColor: colors.pausedBorder,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 14,
  },
  codeLabel: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.textMuted,
  },
  codeValue: {
    fontFamily: fonts.headingBold,
    fontSize: 20,
    letterSpacing: 2,
    color: colors.ink,
    marginTop: 2,
  },
  tipRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
    marginBottom: 18,
  },
  tipIcon: { fontSize: 16 },
  tipText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textBody,
  },
});
