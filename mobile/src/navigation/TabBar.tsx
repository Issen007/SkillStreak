import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

export type TabKey = 'home' | 'chat' | 'goal' | 'team';

interface TabDef {
  key: TabKey;
  icon: string;
  label: string;
}

// Fas 2.6b added "Chatt" as a real fourth tab, placed *second* — a
// deliberate ordering by expected visit frequency, not build order (see
// docs/design/phase2.6-2.7-flows.md's judgment call 5): Hem is the daily
// core loop; Chatt is the one surface a kid plausibly opens several times
// a day; Mål is a weekly check-in at most; Laget (roster/captain
// tools/leaderboard entry) is opened least often of all.
const TABS: TabDef[] = [
  { key: 'home', icon: '🏠', label: 'Hem' },
  { key: 'chat', icon: '💬', label: 'Chatt' },
  { key: 'goal', icon: '🎯', label: 'Mål' },
  { key: 'team', icon: '👥', label: 'Laget' },
];

interface TabBarProps {
  activeTab: TabKey;
  onSelect: (tab: TabKey) => void;
  /** Screen G3's small notification dot on the "Mål" tab. */
  goalTabDot?: boolean;
  /** Fas 2.6b's unread-message dot on the "Chatt" tab — reuses the exact
   * same "presence, not count" dot pattern, per the flow doc's "Unread
   * indicator" note. */
  chatTabDot?: boolean;
}

/** A plain bottom tab bar — not a navigation library, matching AppRoot's
 * and OnboardingFlow's existing "just a state machine" posture for an app
 * this size. */
export function TabBar({ activeTab, onSelect, goalTabDot = false, chatTabDot = false }: TabBarProps) {
  return (
    <View style={styles.bar}>
      {TABS.map((tab) => {
        const active = tab.key === activeTab;
        const showDot = (tab.key === 'goal' && goalTabDot) || (tab.key === 'chat' && chatTabDot);
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(tab.key)}
            style={styles.tab}
          >
            <View>
              <Text style={styles.icon}>{tab.icon}</Text>
              {showDot ? <View style={styles.dot} /> : null}
            </View>
            <Text style={[styles.label, active && styles.labelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
    paddingTop: 8,
    paddingBottom: 20,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  icon: {
    fontSize: 20,
  },
  dot: {
    position: 'absolute',
    top: -2,
    right: -6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.gold,
  },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    color: colors.textMuted,
  },
  labelActive: {
    color: colors.flame,
  },
});
