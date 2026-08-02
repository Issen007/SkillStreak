import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from '../../components/PrimaryButton';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface V7SuccessProps {
  onDone: () => void;
}

/** Screen V7 — "Klippet är uppe! 🎉" Brief, not a big takeover (smaller
 * than H5's streak celebration — there's no number ticking up here).
 * "Till flödet" re-fetches the feed rather than locally splicing the new
 * clip in, per the flow doc — keeps the client honestly in sync with
 * whatever the server actually has, including the fresh presigned
 * `playbackUrl`. */
export function V7Success({ onDone }: V7SuccessProps) {
  const { t } = useTranslation('clips');

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>{t('v7.heading')}</Text>
      <Text style={styles.sub}>{t('v7.sub')}</Text>
      <PrimaryButton label={t('v7.done')} onPress={onDone} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 14,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 22,
    color: colors.ink,
    textAlign: 'center',
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textBody,
    textAlign: 'center',
    marginBottom: 8,
  },
});
