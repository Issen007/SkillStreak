import { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { getTrainerFeed } from '../api/endpoints';
import type { TrainerPost } from '../api/types';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

/**
 * Tips from trainers — the reader's half of the trainer feed.
 *
 * Every post here was written by an adult and read by an operator before
 * it appeared. That is the whole safety story, and it is why this screen
 * is as plain as it is.
 *
 * What this screen deliberately does NOT have, each absence matching the
 * API that feeds it:
 *
 * - **No way to reach an author.** A byline, and nothing else. Publishing
 *   TO children is a different thing from corresponding WITH them.
 * - **No comments, likes or reactions.** Nothing a child writes goes
 *   anywhere near this feature, so there is no moderation queue for
 *   children's words and no way for one child's opinion to reach another
 *   through it.
 * - **No infinite scroll and no algorithm.** Newest first, one page, and
 *   it ends. This app exists to pull children away from feeds that never
 *   end (see CLAUDE.md); shipping one here would be working against the
 *   product's whole reason for existing.
 *
 * That last one is worth stating plainly because it will be tempting
 * later: "more engagement" is the wrong goal for this screen. A player
 * should read a tip, close the app, and go and try it.
 */
export function TipsScreen() {
  const { t } = useTranslation('tips');
  const [posts, setPosts] = useState<TrainerPost[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setFailed(false);
      setPosts(await getTrainerFeed());
    } catch {
      // The feed is not load-bearing: a child whose tips fail to load has
      // lost nothing they were relying on, so this states the problem
      // quietly rather than as an error.
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor={colors.textMuted}
        />
      }
    >
      <Text style={styles.heading}>{t('heading')}</Text>
      <Text style={styles.intro}>{t('intro')}</Text>

      {posts === null && !failed ? (
        <Text style={styles.muted}>{t('loading')}</Text>
      ) : null}

      {failed ? <Text style={styles.muted}>{t('failed')}</Text> : null}

      {posts !== null && posts.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.muted}>{t('empty')}</Text>
        </View>
      ) : null}

      {(posts ?? []).map((post) => (
        <View key={post.id} style={styles.card}>
          <Text style={styles.title}>{post.title}</Text>
          <Text style={styles.byline}>{post.authorByline}</Text>
          {/* Plain <Text>, never anything that parses markup: this is
              text a person outside the child's team wrote. */}
          <Text style={styles.body}>{post.body}</Text>
        </View>
      ))}

      {posts !== null && posts.length > 0 ? (
        // A visible end. The list stops, and saying so is the point —
        // see the note about infinite scroll above.
        <Text style={styles.end}>{t('end')}</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 16, paddingBottom: 32 },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 24,
    color: colors.ink,
    marginBottom: 4,
  },
  intro: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 16,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  title: {
    fontFamily: fonts.headingBold,
    fontSize: 17,
    color: colors.ink,
    marginBottom: 2,
  },
  byline: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 10,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
  },
  muted: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
  },
  end: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },
});
