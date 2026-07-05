import { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, View, ViewStyle } from 'react-native';

import { colors } from '../theme/colors';

interface ScreenContainerProps extends PropsWithChildren {
  scroll?: boolean;
  style?: ViewStyle;
}

/** Shared `paper`-background full-screen wrapper for onboarding screens. */
export function ScreenContainer({ children, scroll = false, style }: ScreenContainerProps) {
  if (scroll) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.scrollContent, style]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    );
  }
  return <View style={[styles.container, styles.plainContent, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 32,
    gap: 16,
  },
  plainContent: {
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 32,
    gap: 16,
  },
});
