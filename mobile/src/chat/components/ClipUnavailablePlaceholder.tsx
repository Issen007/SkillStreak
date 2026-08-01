import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

/** ADR-0017 Part E — the one single, generic, non-alarming "clip is gone"
 * state, shown for every reason `clip` can resolve to `null` on a message
 * that (per `ChatScreen`'s 3-case logic) must have originally carried one.
 * Deliberately compact — "roughly the height of one text line plus the
 * icon," NOT the same tall footprint as a real video card — and a neutral,
 * muted fill, never red/alarming: a clip aging out or being self-deleted is
 * a routine content-lifecycle outcome, not evidence of anything the
 * *viewer* did wrong. */
export function ClipUnavailablePlaceholder() {
  const { t } = useTranslation('chat');

  return (
    <View style={styles.box}>
      <Text style={styles.text}>{t('clipUnavailable.text')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignSelf: 'stretch',
  },
  text: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.textMuted,
  },
});
