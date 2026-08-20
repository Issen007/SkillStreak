import { ScrollView, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from '../../components/PrimaryButton';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface BugReportSentScreenProps {
  onDone: () => void;
}

/** Screen BR3 — docs/design/phase7-admin-console-flows.md §9.5.
 *
 * Reuses `ErasureCheckEmailScreen`'s exact shape (icon / heading / body /
 * single CTA) rather than inventing a second success pattern.
 *
 * **Deliberately promises no reply.** There is no reply channel in this
 * design — Decision 7's `PATCH` moves a report's status and nothing
 * writes back to the child — so copy like "we'll get back to you" would
 * be a promise the system structurally cannot keep. Same discipline as
 * E5's "Trycker du inte på länken händer ingenting". */
export function BugReportSentScreen({ onDone }: BugReportSentScreenProps) {
  const { t } = useTranslation('home');
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.icon}>📨</Text>
      <Text style={styles.heading}>{t('bugReport.successHeading')}</Text>
      <Text style={styles.body}>{t('bugReport.successBody')}</Text>
      <PrimaryButton label={t('bugReport.successCta')} onPress={onDone} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 88,
    paddingBottom: 32,
    gap: 14,
  },
  icon: {
    fontSize: 32,
    textAlign: 'center',
  },
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
