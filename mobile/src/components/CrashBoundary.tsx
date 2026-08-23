import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import i18n from '../i18n';
import { reportClientError } from '../api/clientErrors';
import { colors } from '../theme/colors';

/**
 * The last thing standing between a render crash and a white screen.
 *
 * Two jobs, and they are independent — either is worth having alone:
 *
 * 1. **Tell somebody.** Until now a crash in this app left no trace on any
 *    machine this project controls. The child sees the app die, closes it,
 *    and that is the entire record of the event. Through a closed beta
 *    that is survivable because the owner can ask the team; from the week
 *    this is on two public stores it is not.
 * 2. **Say something to the child.** React's default for an uncaught
 *    render error in a production build is to unmount the whole tree — a
 *    blank screen with no explanation, which to a nine-year-old is
 *    indistinguishable from the app being broken forever.
 *
 * ## Why the copy is defensive about i18n
 *
 * `t()` is read inside a try/catch with Swedish literals behind it,
 * which looks like belt-and-braces and is not. This component renders
 * precisely when something in the tree has already thrown, and i18n is
 * initialised at module scope in a provider above it — so "the thing that
 * broke was translation" is a live possibility, not a hypothetical. A
 * fallback UI that can itself throw gives React nothing to fall back to,
 * and the blank screen returns.
 *
 * Swedish rather than English as the last resort: the users are Swedish
 * children on Swedish teams, and it is the language the app defaults to.
 */

interface Props {
  children: ReactNode;
}

interface State {
  crashed: boolean;
}

type CrashKey = 'crash.title' | 'crash.body' | 'crash.retry';

function translate(key: CrashKey, fallback: string): string {
  try {
    const value = i18n.t(key, fallback, { ns: 'common' });
    return typeof value === 'string' && value.length > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

export class CrashBoundary extends Component<Props, State> {
  state: State = { crashed: false };

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // `info.componentStack` is deliberately not sent. It names this app's
    // own component tree, which is useful — but it is assembled by React
    // from display names and is not covered by the server's redaction,
    // and the error's own stack already says where the throw happened.
    // ADR-0022 Decision 6's rule is that a new kind of context is an
    // explicit, reviewed decision rather than something that arrives
    // because it was conveniently to hand.
    void info;
    void reportClientError(error);
  }

  private reset = (): void => {
    // Remounting the subtree is the only recovery available here, and it
    // genuinely fixes the common case: a crash driven by one bad piece of
    // state that a refetch replaces. When it does not, the child gets the
    // same screen again rather than a dead one, which is still better
    // than nothing and is honest about what happened.
    this.setState({ crashed: false });
  };

  render(): ReactNode {
    if (!this.state.crashed) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.emoji}>🛠️</Text>
        <Text style={styles.title}>
          {translate('crash.title', 'Oj, något gick sönder')}
        </Text>
        <Text style={styles.body}>
          {translate(
            'crash.body',
            'Det var inte ditt fel. Vi har fått veta om det och tittar på saken. Din streak är kvar.',
          )}
        </Text>
        <Pressable
          style={styles.button}
          onPress={this.reset}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>
            {translate('crash.retry', 'Försök igen')}
          </Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
    backgroundColor: colors.paper,
  },
  emoji: { fontSize: 48 },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.ink,
    textAlign: 'center',
  },
  body: {
    fontSize: 16,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  button: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 999,
    backgroundColor: colors.flame,
  },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '700' },
});
