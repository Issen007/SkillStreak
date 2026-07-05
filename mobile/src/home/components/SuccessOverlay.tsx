import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface SuccessOverlayProps {
  /** e.g. "🔥 Snyggt jobbat! 6 dagar i rad." */
  bannerText: string;
  /** e.g. "+15 min till laget" */
  floatingText: string;
  onDismiss: () => void;
}

/** State H5's success moment: a full-width banner plus a floating tag
 * near the team meter, both fading out after ~2.5s with no manual
 * dismiss control (per the flow doc: "celebrate and release"). */
export function SuccessOverlay({ bannerText, floatingText, onDismiss }: SuccessOverlayProps) {
  const bannerOpacity = useRef(new Animated.Value(0)).current;
  const floatTranslate = useRef(new Animated.Value(0)).current;
  const floatOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const sequence = Animated.parallel([
      Animated.sequence([
        Animated.timing(bannerOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.delay(2050),
        Animated.timing(bannerOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.parallel([
          Animated.timing(floatOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
          Animated.timing(floatTranslate, {
            toValue: -18,
            duration: 900,
            useNativeDriver: true,
          }),
        ]),
        Animated.delay(1150),
        Animated.timing(floatOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]),
    ]);
    sequence.start(({ finished }) => {
      if (finished) onDismiss();
    });
    return () => sequence.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Animated.View style={[styles.banner, { opacity: bannerOpacity }]}>
        <Text style={styles.bannerText}>{bannerText}</Text>
      </Animated.View>
      <Animated.View
        style={[
          styles.floatTag,
          {
            opacity: floatOpacity,
            transform: [{ translateY: floatTranslate }],
          },
        ]}
      >
        <Text style={styles.floatText}>{floatingText}</Text>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.ink,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    zIndex: 10,
  },
  bannerText: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: colors.white,
    textAlign: 'center',
  },
  floatTag: {
    position: 'absolute',
    top: 70,
    right: 12,
    backgroundColor: '#FFF4D9',
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 999,
    zIndex: 10,
  },
  floatText: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.goldText,
  },
});
