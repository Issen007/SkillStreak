import { ScrollView, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from '../components/PrimaryButton';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

interface IdeaSentScreenProps {
  onDone: () => void;
}

/**
 * Reuses BugReportSentScreen's exact shape (icon / heading / body / single
 * CTA) rather than inventing a third success pattern.
 *
 * **Deliberately promises no reply**, for the reason its sibling gives:
 * there is no reply channel in this design, so "we'll get back to you"
 * would be a promise the system cannot keep. It says what actually
 * happens instead — a person reads it.
 */
export function IdeaSentScreen({ onDone }: IdeaSentScreenProps) {
  const { t } = useTranslation('tips');
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.icon}>💡</Text>
      <Text style={styles.heading}>{t('idea.successHeading')}</Text>
      <Text style={styles.body}>{t('idea.successBody')}</Text>
      <PrimaryButton label={t('idea.successCta')} onPress={onDone} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: {
    paddingHorizontal: 20,
    paddingTop: 88,
    paddingBottom: 32,
    gap: 14,
  },
  icon: { fontSize: 32, textAlign: 'center' },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 22,
    color: colors.ink,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textBody,
    textAlign: 'center',
    lineHeight: 20,
  },
});
