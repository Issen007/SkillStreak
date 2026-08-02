import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from '../../components/PrimaryButton';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface ClipIntroCardProps {
  onDismiss: () => void;
}

/** Screen V0 — "Så funkar Klipp", the one-time first-open guardrail. Shown
 * once, the first time a player ever opens the Klipp tab — same mechanism
 * as CH0, and (per the flow doc) shown regardless of `consentStatus`: the
 * guardrails are worth knowing before a kid even learns *why* upload might
 * be locked, not gated behind approval themselves. */
export function ClipIntroCard({ onDismiss }: ClipIntroCardProps) {
  const { t } = useTranslation('clips');

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.heading}>{t('v0.heading')}</Text>
        <Text style={styles.bullet}>• {t('v0.bullet1')}</Text>
        <Text style={styles.bullet}>• {t('v0.bullet2')}</Text>
        <Text style={styles.bullet}>• {t('v0.bullet3')}</Text>
        <Text style={styles.bullet}>• {t('v0.bullet4')}</Text>
        <PrimaryButton label={t('v0.dismiss')} onPress={onDismiss} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 20,
    gap: 12,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 19,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: 4,
  },
  bullet: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.textBody,
    lineHeight: 19,
  },
});
