import { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';

/** Animates a displayed integer from its previous value to `target`
 * whenever `target` changes (e.g. H5's streak count ticking up after a
 * fresh log) — no-op animation on first mount, so the number doesn't tick
 * up from 0 every time the home screen loads. Uses core `Animated`
 * (not react-native-reanimated) to keep this dependency-free. */
export function useCountUp(target: number, durationMs = 900): number {
  const [display, setDisplay] = useState(target);
  const previousTarget = useRef(target);
  const animatedValue = useRef(new Animated.Value(target)).current;

  useEffect(() => {
    const from = previousTarget.current;
    previousTarget.current = target;
    if (from === target) {
      return;
    }

    animatedValue.setValue(from);
    const listenerId = animatedValue.addListener(({ value }) => {
      setDisplay(Math.round(value));
    });

    const animation = Animated.timing(animatedValue, {
      toValue: target,
      duration: durationMs,
      useNativeDriver: false,
    });
    animation.start(() => {
      setDisplay(target);
    });

    return () => {
      animatedValue.removeListener(listenerId);
      animation.stop();
    };
  }, [target, durationMs, animatedValue]);

  return display;
}
