import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ClipPickerCard } from './ClipPickerCard';
import { PrimaryButton } from '../../components/PrimaryButton';
import { getClips } from '../../api/endpoints';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import type { ClipFeedItem } from '../../api/types';

const PICKER_PAGE_SIZE = 20;

interface ClipAttachSheetProps {
  visible: boolean;
  teamId: string;
  /** A card was tapped — the caller attaches it and closes this sheet. */
  onSelect: (clip: ClipFeedItem) => void;
  /** "✕" — dismiss, no selection made, composer unchanged. */
  onClose: () => void;
  /** Empty state's "Gå till Klipp" — closes this sheet and switches
   * AppShell's active tab to "Klipp", per the flow doc. */
  onGoToClipsTab: () => void;
}

/** Screen CH6 — the compose-time clip picker (ADR-0017 Decision 3). Calls
 * the exact same `GET /api/v1/teams/:teamId/clips` the Klipp tab's own feed
 * (V2) already uses — no new endpoint, this is a second *renderer* of that
 * data. Re-fetches from scratch every time it opens (own internal state,
 * reset on `visible`) rather than persisting across opens, since a fresh
 * `playbackUrl` should back every card shown, same as V2's own posture. */
export function ClipAttachSheet({ visible, teamId, onSelect, onClose, onGoToClipsTab }: ClipAttachSheetProps) {
  const { t } = useTranslation('chat');
  const [clips, setClips] = useState<ClipFeedItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const fetchInitial = useCallback(async () => {
    try {
      const response = await getClips(teamId, { limit: PICKER_PAGE_SIZE });
      setClips(response.clips);
      setHasMore(response.clips.length === PICKER_PAGE_SIZE);
      setLoadError(null);
    } catch {
      setLoadError(t('ch6.loadError'));
    }
  }, [teamId, t]);

  useEffect(() => {
    if (!visible) return;
    setClips(null);
    setLoadError(null);
    void fetchInitial();
  }, [visible, fetchInitial]);

  const handleShowMore = async () => {
    if (!clips || clips.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = clips[clips.length - 1];
      const response = await getClips(teamId, { before: oldest.createdAt, limit: PICKER_PAGE_SIZE });
      setClips((prev) => [...(prev ?? []), ...response.clips]);
      setHasMore(response.clips.length === PICKER_PAGE_SIZE);
    } catch {
      // Silent — the "Visa fler klipp" button just stays available to retry.
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.heading}>{t('ch6.heading')}</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
            <Text style={styles.closeIcon}>✕</Text>
          </Pressable>
        </View>

        {clips === null ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.flame} size="large" />
          </View>
        ) : loadError ? (
          <View style={styles.centered}>
            <Text style={styles.errorText}>{loadError}</Text>
            <Text style={styles.retryText} onPress={() => void fetchInitial()}>
              {t('ch6.retry')}
            </Text>
          </View>
        ) : clips.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyHeading}>{t('ch6.emptyHeading')}</Text>
            <Text style={styles.emptySub}>{t('ch6.emptySub')}</Text>
            <PrimaryButton label={t('ch6.goToClips')} onPress={onGoToClipsTab} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={styles.grid}>
              {clips.map((clip) => (
                <View key={clip.clipId} style={styles.gridItem}>
                  <ClipPickerCard clip={clip} onSelect={() => onSelect(clip)} />
                </View>
              ))}
            </View>
            {hasMore ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void handleShowMore()}
                disabled={loadingMore}
                style={styles.showMoreButton}
              >
                {loadingMore ? (
                  <ActivityIndicator color={colors.ink} />
                ) : (
                  <Text style={styles.showMoreText}>{t('ch6.showMore')}</Text>
                )}
              </Pressable>
            ) : null}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 18,
    color: colors.ink,
  },
  closeIcon: {
    fontSize: 18,
    color: colors.textMuted,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
    textAlign: 'center',
  },
  retryText: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.ink,
    textDecorationLine: 'underline',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 28,
  },
  emptyHeading: {
    fontFamily: fonts.headingBold,
    fontSize: 17,
    color: colors.ink,
  },
  emptySub: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 6,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gridItem: {
    width: '47%',
  },
  showMoreButton: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  showMoreText: {
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
    color: colors.ink,
    textDecorationLine: 'underline',
  },
});
