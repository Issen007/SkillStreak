import { ActivityIndicator, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

interface LoadingOrRetryProps {
  /** True while the underlying fetch is in flight — renders the spinner
   * and ignores `errorMessage`/`retryLabel`/`onRetry` entirely, matching
   * every call site's existing two-branch shape ("if loading, show a
   * spinner; else if there's an error, show it with a retry link"). */
  loading: boolean;
  errorMessage?: string;
  retryLabel?: string;
  onRetry?: () => void;
  /** Defaults to `colors.flame`, this app's default spinner color; pass
   * `colors.gold` for a team/goal-motif screen (see `GoalScreen`). */
  spinnerColor?: string;
  /** When true (the default), applies the shared full-screen container
   * treatment (`flex: 1`, paper background, centered, 24px horizontal
   * padding, 12px gap) before `style` — the shape every full-screen
   * loading/error state in this app uses. Set to `false` for a usage
   * embedded inline in an already-flexed/scrollable parent (e.g. Klipp's
   * mid-feed loading/error state, nested inside a `ScrollView`), which
   * gets only centering and whatever `style` supplies. */
  fullScreen?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Shared loading-spinner / error-with-retry block. Previously five
 * screens (Home, Team, Roster, Mål, Klipp) each hand-rolled the same
 * `ActivityIndicator` + error `Text` + underlined retry `Text` combo and
 * the same `centered`/`errorText`/`retryText` style objects — see
 * mobile/README.md's former "Known duplication" note. `fullScreen`/
 * `style` let a caller reproduce its own exact layout (full-screen vs.
 * embedded inline) rather than forcing one visual shape on every call
 * site. */
export function LoadingOrRetry({
  loading,
  errorMessage,
  retryLabel,
  onRetry,
  spinnerColor = colors.flame,
  fullScreen = true,
  style,
}: LoadingOrRetryProps) {
  return (
    <View style={[styles.base, fullScreen && styles.fullScreen, style]}>
      {loading ? (
        <ActivityIndicator color={spinnerColor} size="large" />
      ) : (
        <>
          <Text style={styles.errorText}>{errorMessage}</Text>
          {retryLabel && onRetry ? (
            <Text style={styles.retryText} onPress={onRetry}>
              {retryLabel}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullScreen: {
    flex: 1,
    backgroundColor: colors.paper,
    gap: 12,
    paddingHorizontal: 24,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
    textAlign: 'center',
  },
  retryText: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.ink,
    textDecorationLine: 'underline',
  },
});
