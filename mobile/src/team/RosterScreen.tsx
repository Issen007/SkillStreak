import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { RosterRow } from './components/RosterRow';
import { ReminderActionSheet } from './components/ReminderActionSheet';
import { Toast } from '../components/Toast';
import { SecondaryLink } from '../components/SecondaryLink';
import { getTeamRoster, sendConsentReminder, triggerSessionReissue } from '../api/endpoints';
import { ApiError } from '../api/ApiError';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import type { RosterPlayer } from '../api/types';

interface RosterScreenProps {
  teamId: string;
  onBack: () => void;
  /** Defensive bounce-back if this screen is somehow reached by a
   * non-captain (e.g. a stale deep link) — K1's own entry button is
   * already gated on `viewerIsCaptain`, but the service-layer `403
   * not_team_captain` is the real gate, per the flow doc. */
  onNotCaptain: () => void;
}

/** Screen K2 — the captain-only full roster list. Self-contained fetch on
 * mount, same pattern as every other Phase 1/2 screen in this app. */
export function RosterScreen({ teamId, onBack, onNotCaptain }: RosterScreenProps) {
  const { t } = useTranslation('team');
  const [players, setPlayers] = useState<RosterPlayer[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [sheetTarget, setSheetTarget] = useState<RosterPlayer | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [reissueLoading, setReissueLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const fetchRoster = useCallback(async () => {
    try {
      const response = await getTeamRoster(teamId);
      setPlayers(response.players);
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'not_team_captain') {
        onNotCaptain();
        return;
      }
      setLoadError(t('k2.loadError'));
    } finally {
      setLoading(false);
    }
  }, [teamId, onNotCaptain, t]);

  useEffect(() => {
    void fetchRoster();
  }, [fetchRoster]);

  const handleSendReminder = async () => {
    if (!sheetTarget) return;
    setSheetLoading(true);
    try {
      await sendConsentReminder(sheetTarget.playerId);
      setSheetTarget(null);
      setToastMessage(t('k2.reminderSentToast'));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'consent_not_pending') {
        setSheetTarget(null);
        setToastMessage(t('k2.consentNoLongerPendingToast'));
        void fetchRoster();
      } else {
        setToastMessage(t('k2.reminderErrorToast'));
      }
    } finally {
      setSheetLoading(false);
    }
  };

  const handleSendReissue = async () => {
    if (!sheetTarget) return;
    setReissueLoading(true);
    try {
      await triggerSessionReissue(sheetTarget.playerId);
      setSheetTarget(null);
      // The code itself was never in this response (docs/adr/0004-coach-
      // auth-and-session-reissue.md's 2026-07-27 addendum) — it went
      // straight to the player's own parent_contact by email, so this
      // toast can only confirm the request went out, not show anything.
      setToastMessage(t('k2.reissueSentToast'));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'session_reissue_rate_limited') {
        setSheetTarget(null);
        setToastMessage(t('k2.reissueRateLimitedToast'));
      } else {
        setToastMessage(t('k2.reminderErrorToast'));
      }
    } finally {
      setReissueLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.flame} size="large" />
      </View>
    );
  }

  if (loadError || !players) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{loadError ?? t('k2.genericError')}</Text>
        <Text style={styles.retryText} onPress={() => void fetchRoster()}>
          {t('k2.retry')}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>{t('k2.heading')}</Text>
        {players.map((player) => (
          <RosterRow
            key={player.playerId}
            screenName={player.screenName}
            avatarId={player.avatarId}
            consentStatus={player.consentStatus}
            lastTrainedDate={player.lastTrainedDate}
            isCaptain={player.isCaptain}
            onPress={() => setSheetTarget(player)}
          />
        ))}
        <SecondaryLink label={t('k2.back')} onPress={onBack} />
      </ScrollView>

      <ReminderActionSheet
        visible={sheetTarget !== null}
        screenName={sheetTarget?.screenName ?? ''}
        loading={sheetLoading}
        reissueLoading={reissueLoading}
        onClose={() => setSheetTarget(null)}
        onSendReminder={() => void handleSendReminder()}
        onSendReissue={() => void handleSendReissue()}
      />

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
    gap: 4,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 20,
    color: colors.ink,
    marginBottom: 8,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
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
});
