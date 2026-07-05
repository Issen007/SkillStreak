import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '../../components/ScreenContainer';
import { PrimaryButton } from '../../components/PrimaryButton';
import { TextField } from '../../components/TextField';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { previewInvite } from '../../api/endpoints';
import { ApiError } from '../../api/ApiError';

interface O1EnterCodeProps {
  initialCode: string;
  /** Non-null when re-entering this screen because a previously-valid code
   * stopped working between O1 and O5 (see the flow doc's O5 404 case). */
  externalError?: string | null;
  onFound: (inviteCode: string, teamId: string, teamName: string) => void;
}

export function O1EnterCode({ initialCode, externalError, onFound }: O1EnterCodeProps) {
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
        // Deliberately generic per the contract — no "did you mean..."
        // hinting layered on top client-side.
        setError('Vi hittade ingen lag med den koden. Dubbelkolla med din tränare!');
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
      <Text style={styles.heading}>Vilket lag kör du för?</Text>
      <Text style={styles.sub}>Fråga din tränare om lagets kod.</Text>

      <TextField
        value={code}
        onChangeText={(text) => {
          setCode(text);
          if (error) setError(null);
        }}
        placeholder="T.ex. FALKEN24"
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        errorText={error ?? undefined}
        returnKeyType="go"
        onSubmitEditing={handleSubmit}
      />

      <View style={styles.spacer} />

      <PrimaryButton
        label="Hitta mitt lag"
        onPress={handleSubmit}
        disabled={code.trim().length === 0}
        loading={loading}
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
});
