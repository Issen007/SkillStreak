import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '../../components/ScreenContainer';
import { PrimaryButton } from '../../components/PrimaryButton';
import { TextField } from '../../components/TextField';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { requestSessionReissue } from '../../api/endpoints';

interface RA1ReturningUserProps {
  onSubmitted: () => void;
  onBack: () => void;
}

/** Screen RA1 — docs/adr/0004-coach-auth-and-session-reissue.md's
 * 2026-07-27 addendum, the confirmed real "I already have an account" gap
 * (docs/PROJECT.md's Fas 4 punch list). Deliberately never tells the
 * player whether inviteCode/screenName actually matched anything — the
 * backend's response is identical either way (anti-enumeration), so this
 * screen always moves on to RA2 regardless of what the API said. */
export function RA1ReturningUser({ onSubmitted, onBack }: RA1ReturningUserProps) {
  const [inviteCode, setInviteCode] = useState('');
  const [screenName, setScreenName] = useState('');
  const [loading, setLoading] = useState(false);

  const canSubmit = inviteCode.trim().length > 0 && screenName.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    try {
      // Best-effort, fire-and-forget from the UI's perspective — the
      // backend never distinguishes "sent" from "no match" in its
      // response, and neither should this screen (see the ADR addendum).
      await requestSessionReissue({
        inviteCode: inviteCode.trim(),
        screenName: screenName.trim(),
      });
    } catch {
      // Network/unexpected errors are swallowed the same way — this
      // screen has nothing meaningful to say beyond "check your inbox",
      // and retrying costs nothing (RA2 has a "skicka igen" link back
      // here).
    } finally {
      setLoading(false);
      onSubmitted();
    }
  };

  return (
    <ScreenContainer scroll>
      <View style={styles.spacerTop} />
      <Text style={styles.heading}>Har du redan ett konto?</Text>
      <Text style={styles.sub}>
        Ange lagets kod och ditt användarnamn, så skickar vi en inloggningskod
        till din (eller din förälders) e-post.
      </Text>

      <TextField
        value={inviteCode}
        onChangeText={setInviteCode}
        placeholder="Lagkod, t.ex. FALKEN24"
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
      />
      <View style={styles.fieldGap} />
      <TextField
        value={screenName}
        onChangeText={setScreenName}
        placeholder="Ditt användarnamn"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        returnKeyType="go"
        onSubmitEditing={handleSubmit}
      />

      <View style={styles.spacer} />

      <PrimaryButton
        label="Skicka kod"
        onPress={handleSubmit}
        disabled={!canSubmit}
        loading={loading}
      />
      <Text style={styles.backLink} onPress={onBack}>
        Tillbaka
      </Text>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  spacerTop: { height: 24 },
  spacer: { flex: 1, minHeight: 24 },
  fieldGap: { height: 12 },
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
  backLink: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    textDecorationLine: 'underline',
    marginTop: 16,
  },
});
