import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { TeammateStatusRow } from '../components/TeammateStatusRow';
import { SecondaryLink } from '../../components/SecondaryLink';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { targetUnitLabel } from '../types';
import type { PlayerGoalProgress, WeeklyGoalTargetUnit } from '../../api/types';

interface G1DTeammateStatusProps {
  goalTitle: string;
  players: PlayerGoalProgress[];
  targetValue: number;
  targetUnit: WeeklyGoalTargetUnit;
  onBack: () => void;
}

const EXCLUSION_CAPTIONS: Record<string, string> = {
  joined_after_start: 'Gick med efter att målet redan startat',
  consent_pending: 'Väntar på godkännande från förälder ⏳',
  consent_revoked: 'Pausad ⏸️',
  team_join_pending: 'Väntar på att bli godkänd i laget ⏳',
};

/** Screen G1D — "Lagkompisarnas status", per docs/design/
 * phase2.10-per-player-goal-flows.md. A client-side view state, not a new
 * route/API call (same "view-state machine" pattern `GoalScreen` already
 * uses for 'card' | 'builder' | 'history') — `players[]` is already on
 * whichever response (`GET .../weekly-goal` or `GET .../dashboard`) loaded
 * the `GoalCard` this was opened from.
 *
 * Three sections, each omitted entirely when empty (same convention as
 * `ConsentChips`). Roster order is preserved within each section — never
 * re-sorted by progress amount, which would recreate the per-player
 * ranking this app deliberately doesn't have anywhere. Excluded rows show
 * a caption only when `exclusionReason` arrived non-null (ADR-0015
 * Decision 4 — always true for a non-captain viewer already, no
 * client-side role check needed here). */
export function G1DTeammateStatus({
  goalTitle,
  players,
  targetValue,
  targetUnit,
  onBack,
}: G1DTeammateStatusProps) {
  const unitLabel = targetUnitLabel(targetUnit);
  const done = players.filter((p) => p.eligible && p.goalMet);
  const inProgress = players.filter((p) => p.eligible && !p.goalMet);
  const excluded = players.filter((p) => !p.eligible);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerBlock}>
        <Text style={styles.heading}>Lagkompisarnas status</Text>
        <Text style={styles.subHeading}>för &quot;{goalTitle}&quot;</Text>
      </View>

      {done.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>✅ Klara ({done.length})</Text>
          <View style={styles.card}>
            {done.map((player) => (
              <TeammateStatusRow
                key={player.playerId}
                screenName={player.screenName}
                avatarId={player.avatarId}
                variant="done"
              />
            ))}
          </View>
        </>
      ) : null}

      {inProgress.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>⏳ Inte klara än ({inProgress.length})</Text>
          <View style={styles.card}>
            {inProgress.map((player) => (
              <TeammateStatusRow
                key={player.playerId}
                screenName={player.screenName}
                avatarId={player.avatarId}
                variant="in-progress"
                progressValue={player.progressValue}
                targetValue={targetValue}
                unitLabel={unitLabel}
              />
            ))}
          </View>
        </>
      ) : null}

      {excluded.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>➖ Inte med denna vecka ({excluded.length})</Text>
          <View style={styles.card}>
            {excluded.map((player) => (
              <TeammateStatusRow
                key={player.playerId}
                screenName={player.screenName}
                avatarId={player.avatarId}
                variant="excluded"
                exclusionCaption={
                  player.exclusionReason ? EXCLUSION_CAPTIONS[player.exclusionReason] : null
                }
              />
            ))}
          </View>
        </>
      ) : null}

      <SecondaryLink label="Tillbaka" onPress={onBack} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 32,
    gap: 12,
  },
  headerBlock: {
    gap: 2,
    marginBottom: 4,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 22,
    color: colors.ink,
  },
  subHeading: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
  },
  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.ink,
    marginBottom: -6,
  },
  card: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 12,
  },
});
