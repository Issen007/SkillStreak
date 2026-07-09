import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { RosterRow } from './components/RosterRow';
import { ReminderActionSheet } from './components/ReminderActionSheet';
import { Toast } from '../components/Toast';
import { SecondaryLink } from '../components/SecondaryLink';
import { getTeamRoster, sendConsentReminder } from '../api/endpoints';
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
  const [players, setPlayers] = useState<RosterPlayer[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [sheetTarget, setSheetTarget] = useState<RosterPlayer | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
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
      setLoadError('Kunde inte hämta laglistan. Kolla din uppkoppling.');
    } finally {
      setLoading(false);
    }
  }, [teamId, onNotCaptain]);

  useEffect(() => {
    void fetchRoster();
  }, [fetchRoster]);

  const handleSendReminder = async () => {
    if (!sheetTarget) return;
    setSheetLoading(true);
    try {
      await sendConsentReminder(sheetTarget.playerId);
      setSheetTarget(null);
      setToastMessage('Påminnelse skickad.');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'consent_not_pending') {
        setSheetTarget(null);
        setToastMessage('Den här spelaren väntar inte längre på godkännande.');
        void fetchRoster();
      } else {
        setToastMessage('Något gick fel. Testa igen.');
      }
    } finally {
      setSheetLoading(false);
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
        <Text style={styles.errorText}>{loadError ?? 'Något gick fel.'}</Text>
        <Text style={styles.retryText} onPress={() => void fetchRoster()}>
          Försök igen
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Laget i detalj</Text>
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
        <SecondaryLink label="Tillbaka" onPress={onBack} />
      </ScrollView>

      <ReminderActionSheet
        visible={sheetTarget !== null}
        screenName={sheetTarget?.screenName ?? ''}
        loading={sheetLoading}
        onClose={() => setSheetTarget(null)}
        onSendReminder={() => void handleSendReminder()}
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
