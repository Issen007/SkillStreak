import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
} from 'react-native';

/**
 * The short animation between the native splash screen and the app.
 *
 * **Why it can be this simple.** It uses React Native's built-in
 * `Animated` and nothing else — no Lottie, no Reanimated, no new
 * dependency. A logo that scales and fades does not need a vector
 * animation runtime, and this app had just reached a working store build
 * when this was added; adding a native module would have meant rebuilding
 * the one thing that finally worked, to spend bundle size on an effect
 * two properties can express.
 *
 * **Why it continues rather than starts.** The native splash
 * (`expo-splash-screen`, black with the same logo) is already on screen
 * when this mounts, and this renders that same asset at the same rest
 * state on the same black. So the player never sees a cut between two
 * screens — the logo they are already looking at simply comes to life.
 * That continuity is the whole trick, and it is why this uses
 * `splash-icon.png` rather than a different export of the mark.
 *
 * **Why it is short, and why that is a product decision rather than
 * taste.** CLAUDE.md is explicit that this app exists to pull children
 * away from apps engineered to hold them. An intro that plays for three
 * seconds on every launch is a toll booth on the way to logging a
 * training session — the opposite of what the app is for. The whole
 * sequence is under a second, it is skippable with a tap, and it is
 * skipped outright for anyone who has asked their device to reduce
 * motion.
 */

/** Total budget, in ms. Kept in one place so it cannot creep unnoticed. */
const RISE_MS = 380;
const HOLD_MS = 200;
const FADE_MS = 260;

export function IntroAnimation({ onDone }: { onDone: () => void }) {
  // Starts at the native splash's resting state, not from nothing: the
  // logo is already visible at full size when this mounts.
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  // `onDone` is called from an animation callback, which can fire after
  // an unmount if the tree changes mid-sequence. Guarding here rather
  // than in the parent keeps the rule with the thing that can break it.
  const finished = useRef(false);
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onDone();
  }, [onDone]);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!cancelled) setReduceMotion(enabled);
      })
      // If the query fails there is no signal either way, and the safe
      // reading of "no signal" is the calmer one.
      .catch(() => {
        if (!cancelled) setReduceMotion(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion === null) return;
    if (reduceMotion) {
      finish();
      return;
    }

    Animated.sequence([
      // A small overshoot and settle. `back` gives the mark a little
      // weight without it reading as bouncy, which suits a flame better
      // than a spring would.
      Animated.timing(scale, {
        toValue: 1.12,
        duration: RISE_MS,
        easing: Easing.out(Easing.back(1.6)),
        useNativeDriver: true,
      }),
      Animated.delay(HOLD_MS),
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: FADE_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        // Keeps growing as it fades, so it reads as the logo opening out
        // into the app rather than shrinking away from it.
        Animated.timing(scale, {
          toValue: 1.3,
          duration: FADE_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]).start(({ finished: completed }) => {
      // Runs on interruption too. A half-played intro must still hand
      // over — never leave the player on a black screen.
      if (completed) finish();
    });
  }, [reduceMotion, scale, opacity, finish]);

  if (reduceMotion === null || reduceMotion) return null;

  return (
    // Tap anywhere to skip. A child who has seen this two hundred times
    // should be able to get past it, and the gesture costs nothing to
    // support.
    <Pressable style={styles.fill} onPress={finish} accessibilityRole="button">
      <Animated.View style={[styles.fill, { opacity }]}>
        <Animated.Image
          source={require('../../assets/splash-icon.png')}
          style={[styles.mark, { transform: [{ scale }] }]}
          resizeMode="contain"
          // Decorative: the app's name is announced by the screen that
          // follows, and a screen reader user is in the reduce-motion
          // path anyway more often than not.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    // The same black as app.json's splash backgroundColor. If that
    // changes, this must change with it or the handoff will flash.
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: { width: 200, height: 200 },
});
