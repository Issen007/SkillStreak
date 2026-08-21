import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewToken,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTranslation } from 'react-i18next';

import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import {
  clearClipReaction,
  getPublicFeed,
  reactToClip,
  reportPublicClip,
  saveClip,
  unsaveClip,
} from '../api/endpoints';
import type {
  ClipReactionType,
  ClipReportReason,
  PublicFeedItem,
} from '../api/types';
import { ClipReportSheet } from './components/ClipReportSheet';

/** Picker order is the design's order (§5). The glyph lives here and not
 * on the wire — the API stores meaning, so swapping an emoji is a change
 * to this line and nothing else. */
const REACTIONS: ReadonlyArray<{ type: ClipReactionType; glyph: string }> = [
  { type: 'nice', glyph: '🔥' },
  { type: 'strong', glyph: '💪' },
  { type: 'creative', glyph: '🎯' },
  { type: 'well_done', glyph: '👏' },
];

interface PublicFeedScreenProps {
  /** Surfaced by the parent so a toast host exists above the pager. */
  onToast: (message: string) => void;
}

/**
 * Screen F1 — Utforska, the public feed.
 *
 * A full-bleed vertical pager, one clip per screen. That mechanic is the
 * only thing borrowed from the reference apps, and the things
 * deliberately NOT borrowed are what make this list short:
 *
 * - **No profile navigation.** A screen name here is not tappable. There
 *   is no public profile, no "more from this player", no follow. Each of
 *   those is a relationship-building affordance between children who do
 *   not know each other — the exact thing the team-bubble model exists
 *   to prevent. Stated here so it is not later added as an obvious
 *   convenience.
 * - **No share-outside-the-app affordance.** No system share sheet, no
 *   copy link, no download. ADR-0019 Decision 2 bounds "public" to
 *   authenticated players; there is no URL that survives leaving the app
 *   and the UI must not imply otherwise.
 * - **No reaction totals.** A viewer sees their own reaction and nobody
 *   else's — see the API's ClipReactionsService for that argument.
 * - **No team name and no tagged teammate**, which the server already
 *   refuses to send. Named here too, because a future "helpful" field is
 *   added on the client first.
 */
export function PublicFeedScreen({ onToast }: PublicFeedScreenProps) {
  const { t } = useTranslation('clips');
  const [items, setItems] = useState<PublicFeedItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [reportTarget, setReportTarget] = useState<PublicFeedItem | null>(null);
  const [reportSubmitting, setReportSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const page = await getPublicFeed();
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getPublicFeed(cursor);
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      // Silent: the child still has a full screen of clips, and an error
      // banner over a video they are watching is worse than a feed that
      // simply stops.
    } finally {
      setLoadingMore(false);
    }
  }

  /**
   * Optimistic, because a reaction is a 60ms gesture and waiting on a
   * round trip makes the rail feel broken. Reverted on failure, which is
   * safe: the server is authoritative and a failed tap leaves no row.
   */
  async function handleReact(item: PublicFeedItem, type: ClipReactionType) {
    const previous = item.myReaction;
    const next = previous === type ? null : type;
    setItems((prev) =>
      (prev ?? []).map((c) =>
        c.clipId === item.clipId ? { ...c, myReaction: next } : c,
      ),
    );
    try {
      if (next === null) await clearClipReaction(item.clipId);
      else await reactToClip(item.clipId, next);
    } catch {
      setItems((prev) =>
        (prev ?? []).map((c) =>
          c.clipId === item.clipId ? { ...c, myReaction: previous } : c,
        ),
      );
      onToast(t('publicFeed.reactionFailed'));
    }
  }

  /** Optimistic, same reasoning as reactions. */
  async function handleSave(item: PublicFeedItem) {
    const next = !item.savedByMe;
    setItems((prev) =>
      (prev ?? []).map((c) =>
        c.clipId === item.clipId ? { ...c, savedByMe: next } : c,
      ),
    );
    try {
      if (next) await saveClip(item.clipId);
      else await unsaveClip(item.clipId);
    } catch {
      setItems((prev) =>
        (prev ?? []).map((c) =>
          c.clipId === item.clipId ? { ...c, savedByMe: !next } : c,
        ),
      );
      onToast(t('publicFeed.reactionFailed'));
    }
  }

  async function handleReport(reason: ClipReportReason) {
    const target = reportTarget;
    if (!target) return;
    setReportSubmitting(true);
    try {
      await reportPublicClip(target.clipId, reason);
      // Removed from this viewer's feed immediately. What happens to it
      // afterwards is another family's business and is never reported
      // back here.
      setItems((prev) => (prev ?? []).filter((c) => c.clipId !== target.clipId));
      setReportTarget(null);
      onToast(t('publicFeed.reportThanks'));
    } catch {
      onToast(t('v2.genericError'));
    } finally {
      setReportSubmitting(false);
    }
  }

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0];
      if (typeof first?.index === 'number') setActiveIndex(first.index);
    },
  ).current;

  if (loadError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.stateBody}>{t('publicFeed.loadError')}</Text>
        <Pressable onPress={() => void load()} accessibilityRole="button">
          <Text style={styles.retry}>{t('v2.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  if (items === null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.flame} size="large" />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.stateHeading}>{t('publicFeed.emptyHeading')}</Text>
        <Text style={styles.stateBody}>{t('publicFeed.emptyBody')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.clipId}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        // Three at a time: the active card plus one either side, so a
        // swipe has something decoded to land on without holding a
        // player open for every clip ever loaded.
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        onEndReachedThreshold={0.5}
        onEndReached={() => void loadMore()}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
        renderItem={({ item, index }) => (
          <PublicFeedCard
            item={item}
            isActive={index === activeIndex}
            onReact={(type) => void handleReact(item, type)}
            onSave={() => void handleSave(item)}
            onReport={() => setReportTarget(item)}
          />
        )}
      />

      <ClipReportSheet
        visible={reportTarget !== null}
        loading={reportSubmitting}
        onSubmit={(reason) => void handleReport(reason)}
        onClose={() => {
          if (!reportSubmitting) setReportTarget(null);
        }}
      />
    </View>
  );
}

interface PublicFeedCardProps {
  item: PublicFeedItem;
  isActive: boolean;
  onReact: (type: ClipReactionType) => void;
  onSave: () => void;
  onReport: () => void;
}

/** One full-screen card. The player is created per mounted card and only
 * ever plays while the card is the visible one — a pager that left three
 * videos playing at once would be three streams of a child's audio. */
function PublicFeedCard({
  item,
  isActive,
  onReact,
  onSave,
  onReport,
}: PublicFeedCardProps) {
  const { t } = useTranslation('clips');
  const { height } = Dimensions.get('window');
  const player = useVideoPlayer(item.playbackUrl, (p) => {
    p.loop = true;
    p.muted = false;
  });

  useEffect(() => {
    if (isActive) player.play();
    else player.pause();
  }, [isActive, player]);

  return (
    <View style={[styles.card, { height }]}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        nativeControls={false}
        contentFit="cover"
      />

      <View style={styles.rail}>
        {REACTIONS.map(({ type, glyph }) => {
          const selected = item.myReaction === type;
          return (
            <Pressable
              key={type}
              onPress={() => onReact(type)}
              style={[styles.railButton, selected ? styles.railButtonOn : null]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={t(`publicFeed.reactions.${type}`)}
            >
              <Text style={styles.railGlyph}>{glyph}</Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={onSave}
          style={[styles.railButton, item.savedByMe ? styles.railButtonOn : null]}
          accessibilityRole="button"
          accessibilityState={{ selected: item.savedByMe }}
          accessibilityLabel={t('publicFeed.saveA11y')}
        >
          <Text style={styles.railGlyph}>🔖</Text>
        </Pressable>
        <Pressable
          onPress={onReport}
          style={styles.railButton}
          accessibilityRole="button"
          accessibilityLabel={t('publicFeed.reportA11y')}
        >
          <Text style={styles.railGlyph}>⚑</Text>
        </Pressable>
      </View>

      <View style={styles.meta}>
        {/* Not a Pressable, and that is the point — see the class doc. */}
        <Text style={styles.screenName}>{item.screenName}</Text>
        <Text style={styles.caption}>
          {[item.caption, t('publicFeed.seconds', { count: item.durationSeconds })]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  card: { width: '100%', backgroundColor: '#000', justifyContent: 'flex-end' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
    backgroundColor: colors.paper,
  },
  stateHeading: {
    fontFamily: fonts.headingBold,
    fontSize: 20,
    color: colors.ink,
    textAlign: 'center',
  },
  stateBody: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textBody,
    textAlign: 'center',
    lineHeight: 20,
  },
  retry: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.flame,
    paddingVertical: 8,
  },
  rail: {
    position: 'absolute',
    right: 12,
    bottom: 120,
    gap: 10,
    alignItems: 'center',
  },
  railButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  railButtonOn: {
    backgroundColor: 'rgba(255,107,53,0.85)',
    borderColor: colors.flame,
  },
  railGlyph: { fontSize: 22, color: '#FFF' },
  meta: {
    position: 'absolute',
    left: 16,
    right: 76,
    bottom: 40,
    gap: 4,
  },
  screenName: {
    fontFamily: fonts.headingBold,
    fontSize: 16,
    color: '#FFF',
  },
  caption: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: 'rgba(255,255,255,0.86)',
    lineHeight: 19,
  },
});
