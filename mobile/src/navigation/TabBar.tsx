import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

export type TabKey = 'home' | 'chat' | 'clips' | 'goal' | 'team';

interface TabDef {
  key: TabKey;
  icon: string;
  /** `common.tabs.<key>` — the i18next key for this tab's label, kept
   * alongside the icon so the render loop doesn't need a separate lookup
   * table. */
  labelKey: 'tabs.home' | 'tabs.chat' | 'tabs.clips' | 'tabs.goal' | 'tabs.team';
}

// Fas 2.6b added "Chatt" as a real fourth tab, placed *second* — a
// deliberate ordering by expected visit frequency, not build order (see
// docs/design/phase2.6-2.7-flows.md's judgment call 5): Hem is the daily
// core loop; Chatt is the one surface a kid plausibly opens several times
// a day; Mål is a weekly check-in at most; Laget (roster/captain
// tools/leaderboard entry) is opened least often of all. Fas 3 adds "Klipp"
// as a fifth tab, placed *third* (between Chatt and Mål) — per
// docs/design/phase3-flows.md's judgment call 1, a real, frequently-checked
// pull, but a small roster realistically posts new clips less often than
// new chat messages, so it sits just behind Chatt rather than tied with it.
const TABS: TabDef[] = [
  { key: 'home', icon: '🏠', labelKey: 'tabs.home' },
  { key: 'chat', icon: '💬', labelKey: 'tabs.chat' },
  { key: 'clips', icon: '🎬', labelKey: 'tabs.clips' },
  { key: 'goal', icon: '🎯', labelKey: 'tabs.goal' },
  { key: 'team', icon: '👥', labelKey: 'tabs.team' },
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
  /** Fas 3's unread-clip dot on the "Klipp" tab — identical "presence, not
   * count" convention, per docs/design/phase3-flows.md's "Unread
   * indicator" note. */
  clipsTabDot?: boolean;
  /** Fas 4.6's presence dot for unacknowledged clip challenges on the
   * "Laget" tab — a fifth boolean dot on the same convention, not a
   * fourth exception (docs/design/clip-challenge-notifications-ui.md
   * §1.3). */
  teamTabDot?: boolean;
}

/** A plain bottom tab bar — not a navigation library, matching AppRoot's
 * and OnboardingFlow's existing "just a state machine" posture for an app
 * this size. */
export function TabBar({
  activeTab,
  onSelect,
  goalTabDot = false,
  chatTabDot = false,
  clipsTabDot = false,
  teamTabDot = false,
}: TabBarProps) {
  const { t } = useTranslation('common');
  return (
    <View style={styles.bar}>
      {TABS.map((tab) => {
        const active = tab.key === activeTab;
        const showDot =
          (tab.key === 'goal' && goalTabDot) ||
          (tab.key === 'chat' && chatTabDot) ||
          (tab.key === 'clips' && clipsTabDot) ||
          (tab.key === 'team' && teamTabDot);
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
            <Text style={[styles.label, active && styles.labelActive]}>{t(tab.labelKey)}</Text>
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
