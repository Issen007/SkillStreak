import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '../../components/ScreenContainer';
import { PrimaryButton } from '../../components/PrimaryButton';
import { TextField } from '../../components/TextField';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { redeemSessionCode } from '../../api/endpoints';
import { setSessionToken } from '../../api/authStorage';
import { ApiError } from '../../api/ApiError';

interface RA2RedeemCodeProps {
  /** Called once a real session token is stored — same contract as
   * OnboardingFlow's own onComplete. */
  onRedeemed: () => void;
  /** "Fick du ingen kod?" — back to RA1 to try a different
   * inviteCode/screenName (e.g. a typo the first time). */
  onRetryRequest: () => void;
}

/** Screen RA2 — docs/adr/0004-coach-auth-and-session-reissue.md's
 * 2026-07-27 addendum. Always shown after RA1 submits, regardless of
 * whether a real account was found (the backend's response there is
 * deliberately generic) — this screen's own copy reflects that same
 * "we can't confirm, check your inbox" honesty rather than promising a
 * code is definitely on its way. */
export function RA2RedeemCode({ onRedeemed, onRetryRequest }: RA2RedeemCodeProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const response = await redeemSessionCode(trimmed);
      await setSessionToken(response.sessionToken);
      onRedeemed();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_or_expired_code') {
        setError('Den koden fungerar inte längre. Kolla att du skrev rätt, eller be om en ny.');
      } else {
        setError('Något gick fel. Kolla din uppkoppling och testa igen.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer scroll>
      <View style={styles.spacerTop} />
      <Text style={styles.icon}>📩</Text>
      <Text style={styles.heading}>Kolla inkorgen</Text>
      <Text style={styles.sub}>
        Om uppgifterna stämde har vi skickat en kod till din (eller din
        förälders) e-post. Ange koden nedan för att logga in igen.
      </Text>

      <TextField
        value={code}
        onChangeText={(text) => {
          setCode(text);
          if (error) setError(null);
        }}
        placeholder="T.ex. H4K7QWXP"
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        errorText={error ?? undefined}
        returnKeyType="go"
        onSubmitEditing={handleSubmit}
      />

      <View style={styles.spacer} />

      <PrimaryButton
        label="Logga in"
        onPress={handleSubmit}
        disabled={code.trim().length === 0}
        loading={loading}
      />
      <Text style={styles.backLink} onPress={onRetryRequest}>
        Fick du ingen kod? Försök igen
      </Text>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  spacerTop: { height: 24 },
  spacer: { flex: 1, minHeight: 24 },
  icon: {
    fontSize: 36,
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
  backLink: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    textDecorationLine: 'underline',
    marginTop: 16,
  },
});
