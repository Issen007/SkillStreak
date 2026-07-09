import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { TeammateRow } from './components/TeammateRow';
import { CaptainTransferConfirmSheet } from './components/CaptainTransferConfirmSheet';
import { Toast } from '../components/Toast';
import { SecondaryLink } from '../components/SecondaryLink';
import { getTeammates, transferCaptaincy } from '../api/endpoints';
import { ApiError } from '../api/ApiError';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import type { TeammateEntry } from '../api/types';

interface CaptainTransferScreenProps {
  teamId: string;
  viewerPlayerId: string;
  onBack: () => void;
  /** Defensive bounce-back if this screen is somehow reached by a
   * non-captain (e.g. stale UI) — K1's own entry button is already gated
   * on `viewerIsCaptain`, but the service-layer `403 not_team_captain` is
   * the real gate, per the flow doc (same posture as RosterScreen). */
  onNotCaptain: () => void;
  /** `200` from the transfer — K1 re-fetches both the dashboard and the
   * teammates list and shows its own toast; also lets AppShell suppress
   * its next "captaincy handed off" catch-up banner for this same device
   * (it already knows, from this very screen). */
  onTransferred: (newCaptainScreenName: string) => void;
}

/** Screen K4 — captain-only "Välj ny kapten" flow. Refetches the
 * teammates list on entry rather than trusting K1's cached copy (staleness
 * here would mean showing an out-of-date captain badge on a screen whose
 * whole job is "who can I hand this to"), per the flow doc. */
export function CaptainTransferScreen({
  teamId,
  viewerPlayerId,
  onBack,
  onNotCaptain,
  onTransferred,
}: CaptainTransferScreenProps) {
  const [teammates, setTeammates] = useState<TeammateEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [target, setTarget] = useState<TeammateEntry | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const fetchTeammates = useCallback(async () => {
    try {
      const response = await getTeammates(teamId);
      setTeammates(response.teammates);
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
    void fetchTeammates();
  }, [fetchTeammates]);

  const handleConfirm = async () => {
    if (!target) return;
    setSubmitting(true);
    try {
      await transferCaptaincy(teamId, { newCaptainPlayerId: target.playerId });
      setTarget(null);
      setSubmitting(false);
      onTransferred(target.screenName);
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError) {
        if (err.code === 'player_not_found' || err.code === 'captain_transfer_target_not_on_team') {
          setTarget(null);
          setToastMessage('Kunde inte hitta den spelaren längre. Listan uppdateras.');
          void fetchTeammates();
          return;
        }
        // `captain_transfer_target_is_self` (unreachable — own row is
        // disabled) and `captain_transfer_conflict` (defensive backstop)
        // share the same generic fallback, per the flow doc.
        setTarget(null);
        setToastMessage('Något gick fel. Testa igen.');
        void fetchTeammates();
        return;
      }
      setTarget(null);
      setToastMessage('Något gick fel. Testa igen.');
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.flame} size="large" />
      </View>
    );
  }

  if (loadError || !teammates) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{loadError ?? 'Något gick fel.'}</Text>
        <Text style={styles.retryText} onPress={() => void fetchTeammates()}>
          Försök igen
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Välj ny kapten</Text>
        <Text style={styles.sub}>Den du väljer blir lagets nya kapten direkt.</Text>

        <View style={styles.list}>
          {teammates.map((teammate) => {
            const isSelf = teammate.playerId === viewerPlayerId;
            return (
              <TeammateRow
                key={teammate.playerId}
                screenName={teammate.screenName}
                avatarId={teammate.avatarId}
                isCaptain={teammate.isCaptain}
                isSelf={isSelf}
                onPress={isSelf ? undefined : () => setTarget(teammate)}
              />
            );
          })}
        </View>

        <SecondaryLink label="Tillbaka" onPress={onBack} />
      </ScrollView>

      <CaptainTransferConfirmSheet
        visible={target !== null}
        screenName={target?.screenName ?? ''}
        loading={submitting}
        onConfirm={() => void handleConfirm()}
        onClose={() => setTarget(null)}
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
    gap: 8,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 20,
    color: colors.ink,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.textMuted,
    marginBottom: 6,
  },
  list: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 8,
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
