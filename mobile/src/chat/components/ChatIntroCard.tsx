import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from '../../components/PrimaryButton';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface ChatIntroCardProps {
  onDismiss: () => void;
}

/** Screen CH0 — the one-time, first-open guardrail explainer. A light
 * card, not a scary consent-form-style modal: the guardrails need to be
 * known before the first message is typed, not discovered by accident
 * after something goes wrong (docs/design/phase2.6-2.7-flows.md). */
export function ChatIntroCard({ onDismiss }: ChatIntroCardProps) {
  const { t } = useTranslation('chat');

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.heading}>{t('ch0.heading')}</Text>
        <Text style={styles.bullet}>• {t('ch0.bullet1')}</Text>
        <Text style={styles.bullet}>• {t('ch0.bullet2')}</Text>
        <Text style={styles.bullet}>• {t('ch0.bullet3')}</Text>
        <PrimaryButton label={t('ch0.dismiss')} onPress={onDismiss} />
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
