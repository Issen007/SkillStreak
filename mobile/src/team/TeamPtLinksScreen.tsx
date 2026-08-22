import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ParentalGate } from '../components/ParentalGate';

import {
  createTeamPtInvite,
  getTeamPtLinks,
  revokeTeamPtLink,
} from '../api/endpoints';
import { ApiError } from '../api/ApiError';
import type { PtTeamLinkRow } from '../api/types';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { PrimaryButton } from '../components/PrimaryButton';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import { formatSwedishDate } from '../utils/formatDate';

interface TeamPtLinksScreenProps {
  teamId: string;
}

/**
 * Screen CAP1 — docs/design/phase8-pt-flows.md §8. Captain-only; the
 * server enforces that (`assertIsCaptainOfTeam` inside the service), so
 * this screen has no client-side gate of its own to drift out of sync.
 *
 * Carries the design's one deliberate register exception. Revoking a team
 * link is ADR-0023 Decision A4's third lever, and it **cascades**: every
 * family's approved consent under that link ends at once, in one
 * transaction. That makes it the only action in the youth-facing app where
 * a captain acts on other families' behalf — so its confirmation states
 * the blast radius outright, including that the families are not emailed
 * about it (which is an open question in §12, not a settled good).
 */
export function TeamPtLinksScreen({ teamId }: TeamPtLinksScreenProps) {
  const { t } = useTranslation('pt');
  const [links, setLinks] = useState<PtTeamLinkRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ code: string } | null>(null);
  const [inviting, setInviting] = useState(false);
  /* The code waiting behind the parental gate, or null. */
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<PtTeamLinkRow | null>(null);
  const [removing, setRemoving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLinks(await getTeamPtLinks(teamId));
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.code === 'not_team_captain'
          ? t('errors.notCaptain')
          : t('errors.generic'),
      );
    }
  }, [teamId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleInvite = async () => {
    setInviting(true);
    try {
      const result = await createTeamPtInvite(teamId);
      setInvite({ code: result.code });
    } catch {
      setToast(t('errors.generic'));
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async () => {
    if (!pendingRemove) return;
    setRemoving(true);
    try {
      const result = await revokeTeamPtLink(teamId, pendingRemove.id);
      const name = nameOf(pendingRemove);
      // Reporting the cascade count is the honest follow-through on the
      // confirm's own warning: the captain was told this ends other
      // families' approvals, so they are told how many it actually ended.
      setToast(
        result.cascadedConsentCount > 0
          ? t('captain.removedWithConsents', {
              name,
              count: result.cascadedConsentCount,
            })
          : t('captain.removed', { name }),
      );
      setPendingRemove(null);
      await load();
    } catch {
      setToast(t('errors.generic'));
    } finally {
      setRemoving(false);
    }
  };

  if (links === null && loadError === null) {
    return <ActivityIndicator style={styles.loading} color={colors.flame} />;
  }

  const activeLinks = links?.filter((link) => link.status === 'active') ?? [];

  return (
    <View style={styles.screen}>
      <ParentalGate
        visible={shareCode !== null}
        onPass={() => {
          const code = shareCode;
          setShareCode(null);
          if (code) void Share.share({ message: code });
        }}
        onClose={() => setShareCode(null)}
      />
      <Text style={styles.title}>{t('captain.title')}</Text>

      {loadError ? (
        <Text style={styles.error}>{loadError}</Text>
      ) : activeLinks.length === 0 ? (
        <Text style={styles.empty}>{t('captain.empty')}</Text>
      ) : (
        activeLinks.map((link) => (
          <View key={link.id} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.name}>{nameOf(link)}</Text>
              <Text style={styles.meta}>
                {t('captain.memberSince', { date: formatSwedishDate(link.createdAt) })}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setPendingRemove(link)}
              style={styles.removeButton}
            >
              <Text style={styles.removeButtonText}>{t('captain.remove')}</Text>
            </Pressable>
          </View>
        ))
      )}

      {invite ? (
        <View style={styles.inviteCard}>
          <Text style={styles.inviteHeading}>{t('captain.codeTitle')}</Text>
          <Text style={styles.inviteCode}>{invite.code}</Text>
          <Text style={styles.inviteValidity}>{t('captain.codeValidity')}</Text>
          <View style={styles.inviteActions}>
            <Pressable
              accessibilityRole="button"
              /* Same gate as the friend invite: a captain is a child, and
                 the share sheet sends a code out of the app. */
              onPress={() => setShareCode(invite.code)}
              style={styles.shareButton}
            >
              <Text style={styles.shareButtonText}>{t('captain.share')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setInvite(null)}
              style={styles.shareButton}
            >
              <Text style={styles.shareButtonText}>{t('captain.done')}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <PrimaryButton
          label={t('captain.invite')}
          loading={inviting}
          onPress={() => void handleInvite()}
        />
      )}

      <ConfirmSheet
        visible={pendingRemove !== null}
        title={t('captain.removeTitle', { name: pendingRemove ? nameOf(pendingRemove) : '' })}
        body={`${t('captain.removeBody', {
          name: pendingRemove ? nameOf(pendingRemove) : '',
        })}\n\n${t('captain.removeNoEmail')}`}
        cancelLabel={t('captain.cancel')}
        confirmLabel={t('captain.confirm')}
        loading={removing}
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => void handleRemove()}
      />

      {toast ? (
        <Pressable onPress={() => setToast(null)} style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Apple withholds a display name after first login, so the email is the
 * only thing some accounts have. A blank row would be unactionable for a
 * captain deciding whether to remove someone. */
function nameOf(link: PtTeamLinkRow): string {
  return link.ptDisplayName ?? link.ptEmail;
}

const styles = StyleSheet.create({
  screen: { gap: 12 },
  loading: { marginTop: 24 },
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
  removeButton: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.textMuted,
  },
  removeButtonText: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.ink,
  },
  inviteCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    alignItems: 'center',
    gap: 6,
  },
  inviteHeading: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.ink,
  },
  inviteCode: {
    fontFamily: fonts.headingBold,
    fontSize: 28,
    letterSpacing: 4,
    color: colors.ink,
  },
  inviteValidity: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.textMuted,
  },
  inviteActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  shareButton: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.textMuted,
  },
  shareButtonText: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.ink,
  },
  empty: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
  },
  error: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.error,
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
