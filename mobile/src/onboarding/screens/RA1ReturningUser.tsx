import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ScreenContainer } from '../../components/ScreenContainer';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
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
  const { t } = useTranslation('onboarding');
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
      <Text style={styles.heading}>{t('ra1.heading')}</Text>
      <Text style={styles.sub}>{t('ra1.sub')}</Text>

      <TextField
        value={inviteCode}
        onChangeText={setInviteCode}
        placeholder={t('ra1.codePlaceholder')}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
      />
      <View style={styles.fieldGap} />
      <TextField
        value={screenName}
        onChangeText={setScreenName}
        placeholder={t('ra1.namePlaceholder')}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        returnKeyType="go"
        onSubmitEditing={handleSubmit}
      />

      <View style={styles.spacer} />

      <PrimaryButton
        label={t('ra1.submit')}
        onPress={handleSubmit}
        disabled={!canSubmit}
        loading={loading}
      />
      {/* SecondaryLink, not a `Text` with `onPress` — the same three
          defects the 2026-08-23 pass fixed on Screen O1's entry point,
          which had been left standing on the screen that entry point
          leads to. Two of them are not about looks: a `Text` carries no
          `accessibilityRole`, so a screen reader announced this as text
          rather than as something you can activate, and its tap target
          was a single 14pt line on a screen used by nine-year-olds. The
          way out of a screen you opened by mistake should not be the
          hardest thing on it to hit. */}
      <SecondaryLink label={t('ra1.back')} onPress={onBack} />
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
});
