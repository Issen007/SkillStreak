import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ScreenContainer } from '../../components/ScreenContainer';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { TextField } from '../../components/TextField';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { previewInvite } from '../../api/endpoints';
import { ApiError } from '../../api/ApiError';

interface O1EnterCodeProps {
  initialCode: string;
  /** Non-null when re-entering this screen because a previously-valid code
   * stopped working between O1 and O5 (see the flow doc's O5 404/409 error
   * branches). */
  externalError?: string | null;
  /** True only when arriving here from Screen O1a's "Jag skrev nog fel"
   * card — pre-fills `initialCode` and selects it (ready to overtype with
   * one keystroke), per the flow doc's judgment call #9. Deliberately
   * different from O2's "wrong team" rejection, which clears the input
   * instead. */
  selectCodeOnMount?: boolean;
  onFound: (inviteCode: string, teamId: string, teamName: string) => void;
  /** Per ADR-0009: an unmatched code is no longer a dead end — hands off to
   * Screen O1a instead of showing an inline error. */
  onNotFound: (inviteCode: string) => void;
  /** docs/adr/0004-coach-auth-and-session-reissue.md's 2026-07-27 addendum
   * — the confirmed real "I already have an account" gap. */
  onReturningUser: () => void;
}

export function O1EnterCode({
  initialCode,
  externalError,
  selectCodeOnMount,
  onFound,
  onNotFound,
  onReturningUser,
}: O1EnterCodeProps) {
  const { t } = useTranslation('onboarding');
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState<string | null>(externalError ?? null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const response = await previewInvite(trimmed);
      onFound(trimmed, response.teamId, response.teamName);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invite_code_not_found') {
        // No longer a dead end (ADR-0009) — Screen O1a offers a real next
        // step. Deliberately still no client-side "did you mean..."
        // hinting on top of the generic 404.
        onNotFound(trimmed);
      } else {
        setError(t('shared.genericError'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer scroll>
      <View style={styles.spacerTop} />
      <Text style={styles.heading}>{t('o1.heading')}</Text>
      <Text style={styles.sub}>{t('o1.sub')}</Text>

      <TextField
        value={code}
        onChangeText={(text) => {
          setCode(text);
          if (error) setError(null);
        }}
        placeholder={t('o1.codePlaceholder')}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        autoFocus={selectCodeOnMount}
        selectTextOnFocus={selectCodeOnMount}
        errorText={error ?? undefined}
        returnKeyType="go"
        onSubmitEditing={handleSubmit}
      />

      <View style={styles.spacer} />

      <PrimaryButton
        label={t('o1.findTeamButton')}
        onPress={handleSubmit}
        disabled={code.trim().length === 0}
        loading={loading}
      />
      {/* Promoted from an underlined grey `Text` to a real bordered
          button, 2026-08-23, at the project owner's ask that returning
          users be "more highlighted".

          Three things were wrong with the link, and only the first is
          about prominence:

          1. `textMuted` on paper reads as fine print, so the one path a
             returning player needs looked like a disclaimer under the
             thing they should not be doing.
          2. A `Text` with `onPress` has no `accessibilityRole`, so a
             screen reader announced it as text rather than as something
             activatable.
          3. Its tap target was the height of a 14pt line — well under the
             44pt minimum, on a screen used by nine-year-olds.

          SecondaryButton fixes all three and is the component this app
          already uses for "a real second option, subordinate to the
          primary CTA". Deliberately not a second PrimaryButton: joining a
          team IS the main path here, and two equal buttons would make a
          new player stop and choose. */}
      <View style={styles.returningUserSpacer} />
      <SecondaryButton
        label={t('o1.returningUserButton')}
        onPress={onReturningUser}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  spacerTop: { height: 24 },
  spacer: { flex: 1, minHeight: 24 },
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
  returningUserSpacer: { height: 12 },
});
