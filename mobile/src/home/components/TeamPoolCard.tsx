import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface TeamPoolCardProps {
  pointsTotal: number;
  goalThreshold: number;
  percentComplete: number;
  seasonLabel: string;
}

const numberFormatter = new Intl.NumberFormat('sv-SE');

/** Gold-colored team pool card — "ours", per style-guide's flame-vs-gold
 * rule. Shared unchanged across H1/H3/H4/O7 (only the numbers move). */
export function TeamPoolCard({
  pointsTotal,
  goalThreshold,
  percentComplete,
  seasonLabel,
}: TeamPoolCardProps) {
  const widthAnim = useRef(new Animated.Value(percentComplete)).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: percentComplete,
      duration: 1100,
      useNativeDriver: false,
    }).start();
  }, [percentComplete, widthAnim]);

  const widthInterpolated = widthAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Text style={styles.title}>🥇 Lagets VM-Guld-pott</Text>
        <Text style={styles.points}>
          {numberFormatter.format(pointsTotal)} / {numberFormatter.format(goalThreshold)}
        </Text>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { width: widthInterpolated }]} />
      </View>
      <Text style={styles.sub}>
        {percentComplete.toFixed(1).replace('.', ',')} % till guldet {seasonLabel} — alla
        bidrar lika mycket.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 16,
    gap: 10,
  },
  headRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: colors.ink,
  },
  points: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.goldText,
  },
  track: {
    width: '100%',
    height: 11,
    borderRadius: 999,
    backgroundColor: '#F3EEE3',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.gold,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 10.5,
    color: colors.textMuted,
  },
});
