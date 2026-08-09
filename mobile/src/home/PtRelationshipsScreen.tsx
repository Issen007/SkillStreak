import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { getMyPtConsents, revokeMyPtConsent } from '../api/endpoints';
import type { PtConsentSummary } from '../api/types';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import { formatSwedishDate } from '../utils/formatDate';
import { ConfirmSheet } from '../components/ConfirmSheet';

/**
 * Screen PL1 — docs/design/phase8-pt-flows.md §7.
 *
 * ADR-0023 Decision A4 lever 1: the child's own, immediate, unconditional
 * way to end a PT's visibility into their data, with no parent action
 * required. The design's central point, and the reason the closing line
 * exists at all: **a lever a child doesn't know about is not
 * self-determination.**
 *
 * Deliberately understated throughout — no warning colours, no alert
 * iconography. Ending a PT relationship is a normal thing to do, not an
 * emergency exit, and dressing it as destructive would discourage exactly
 * the children most likely to need it.
 */
export function PtRelationshipsScreen() {
  const { t } = useTranslation('pt');
  const [consents, setConsents] = useState<PtConsentSummary[] | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<PtConsentSummary | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setConsents(await getMyPtConsents());
    } catch {
      // Leaves `consents` null, which renders nothing at all — see above.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRevoke = async () => {
    if (!pendingRevoke) return;
    setRevoking(true);
    try {
      await revokeMyPtConsent(pendingRevoke.id);
      setToast(t('mine.ended', { name: pendingRevoke.ptDisplayName }));
      setPendingRevoke(null);
      await load();
    } catch {
      setToast(t('errors.generic'));
    } finally {
      setRevoking(false);
    }
  };

  // Kept inside the component so it closes over the strictly-typed `t`
  // rather than taking a widened `(key: string) => string`, which the
  // typed-resource augmentation (i18n/react-i18next.d.ts) rightly rejects.
  const subtitleFor = (consent: PtConsentSummary): string => {
    if (consent.status === 'approved' && consent.decidedAt) {
      return t('mine.seeingSince', { date: formatSwedishDate(consent.decidedAt) });
    }
    if (consent.status === 'revoked' && consent.revokedAt) {
      return t('mine.endedOn', { date: formatSwedishDate(consent.revokedAt) });
    }
    // pending_review — the family hasn't answered, so nothing is visible to
    // the PT yet and there is no "since" to state.
    return t('mine.statusPending');
  };

  // Not every child needs to meet this concept — the section appears only
  // once a PT relationship actually exists (design §7). A revoked one still
  // counts: the child should be able to see that it happened and stayed
  // ended. Silent on load and on failure for the same reason: an empty
  // profile is the honest default, and a scary error block about a feature
  // this player may never have used would be worse than nothing.
  if (consents === null || consents.length === 0) {
    return null;
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{t('mine.title')}</Text>

      {consents.map((consent) => (
          <View key={consent.id} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.name}>{consent.ptDisplayName}</Text>
              <Text style={styles.meta}>{subtitleFor(consent)}</Text>
            </View>
            {/* Only a live relationship can be ended. A revoked row stays
                visible as history — the child gets to see that it happened
                and that it stayed ended. */}
            {consent.status !== 'revoked' ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setPendingRevoke(consent)}
                style={styles.endButton}
              >
                <Text style={styles.endButtonText}>{t('mine.end')}</Text>
              </Pressable>
            ) : (
              <Text style={styles.endedTag}>{t('mine.statusEnded')}</Text>
            )}
        </View>
      ))}

      {/* The line that makes the lever real. Plain, unalarming, and last —
          a child scanning this screen should end on "this is my choice". */}
      <Text style={styles.yourChoice}>{t('mine.yourChoice')}</Text>

      <ConfirmSheet
        visible={pendingRevoke !== null}
        title={t('mine.confirmTitle', { name: pendingRevoke?.ptDisplayName ?? '' })}
        body={`${t('mine.confirmBody', { name: pendingRevoke?.ptDisplayName ?? '' })}\n${t('mine.confirmAgain')}`}
        cancelLabel={t('mine.cancel')}
        confirmLabel={t('mine.confirm')}
        loading={revoking}
        onCancel={() => setPendingRevoke(null)}
        onConfirm={() => void handleRevoke()}
      />

      {toast ? (
        <Pressable onPress={() => setToast(null)} style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { gap: 12 },
  title: {
    fontFamily: fonts.headingBold,
    fontSize: 18,
    color: colors.ink,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.white,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  rowText: { flex: 1 },
  name: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.ink,
  },
  meta: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.textMuted,
    marginTop: 2,
  },
  endButton: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.textMuted,
  },
  endButtonText: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.ink,
  },
  endedTag: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.textMuted,
  },
  yourChoice: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 4,
  },
  toast: {
    backgroundColor: colors.ink,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  toastText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.white,
  },
});
