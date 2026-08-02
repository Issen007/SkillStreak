import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { SecondaryButton } from '../components/SecondaryButton';
import { SecondaryLink } from '../components/SecondaryLink';
import { Toast } from '../components/Toast';
import { AVATAR_CATALOG } from '../onboarding/avatarCatalog';
import { unblockChatPlayer } from '../api/endpoints';
import { getCachedChatBlocks, removeCachedChatBlock } from '../api/localFlags';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import type { CachedChatBlock } from '../api/localFlags';

interface BlockedListScreenProps {
  teamId: string;
  onBack: () => void;
}

/** Screen CH5 — "Blockerade lagkompisar". Client-cache-backed, a real,
 * stated limitation (see `api/localFlags.ts`'s comment): the contract has
 * no `GET .../chat/blocks` endpoint, so this list is only ever as complete
 * as this device's own block history. `DELETE .../chat/blocks/:id` is
 * still the real, durable unblock — the cache is just how this screen
 * knows what to *offer* unblocking for.
 *
 * Fas 3 addendum: the heading/empty-state copy doesn't need to change (per
 * docs/design/phase3-flows.md, it's already generic), but a small muted sub
 * line was added under the heading so a player understands one block now
 * covers both the chat and the Klipp feed (the same `TeamChatBlock` row,
 * not two independent settings). */
export function BlockedListScreen({ teamId, onBack }: BlockedListScreenProps) {
  const { t } = useTranslation('chat');
  const [blocks, setBlocks] = useState<CachedChatBlock[] | null>(null);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const loadBlocks = useCallback(async () => {
    const cached = await getCachedChatBlocks(teamId);
    setBlocks(cached);
  }, [teamId]);

  useEffect(() => {
    void loadBlocks();
  }, [loadBlocks]);

  const handleUnblock = async (block: CachedChatBlock) => {
    setUnblockingId(block.blockedPlayerId);
    try {
      await unblockChatPlayer(teamId, block.blockedPlayerId);
      await removeCachedChatBlock(teamId, block.blockedPlayerId);
      setBlocks((prev) => (prev ?? []).filter((b) => b.blockedPlayerId !== block.blockedPlayerId));
      setToastMessage(t('ch5.unblockedToast', { screenName: block.screenName }));
    } catch {
      setToastMessage(t('ch5.genericError'));
    } finally {
      setUnblockingId(null);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>{t('ch5.heading')}</Text>
        <Text style={styles.headingSub}>{t('ch5.headingSub')}</Text>

        {blocks === null ? (
          <ActivityIndicator color={colors.flame} />
        ) : blocks.length === 0 ? (
          <Text style={styles.emptyText}>{t('ch5.empty')}</Text>
        ) : (
          blocks.map((block) => {
            const emoji = AVATAR_CATALOG.find((a) => a.avatarId === block.avatarId)?.emoji ?? '🙂';
            return (
              <View key={block.blockedPlayerId} style={styles.row}>
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarEmoji}>{emoji}</Text>
                </View>
                <Text style={styles.name}>{block.screenName}</Text>
                <SecondaryButton
                  label={t('ch5.unblock')}
                  loading={unblockingId === block.blockedPlayerId}
                  onPress={() => void handleUnblock(block)}
                />
              </View>
            );
          })
        )}

        <SecondaryLink label={t('ch5.back')} onPress={onBack} />
      </ScrollView>

      {toastMessage ? <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 32,
    gap: 12,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 20,
    color: colors.ink,
  },
  headingSub: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.textMuted,
    marginTop: -6,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  avatarCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.flameTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: {
    fontSize: 16,
  },
  name: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
    color: colors.ink,
  },
});
