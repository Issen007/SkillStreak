import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  ActiveGoalAlreadyExistsException,
  ChallengeAlreadyTerminalException,
  ChallengeNotFoundException,
  ChallengeTargetFrozenException,
  InvalidChallengeTransitionException,
} from '../common/errors/exceptions';
import { isPostgresUniqueViolation } from '../common/errors/postgres-error.util';
import { stockholmDateString } from '../common/time/stockholm-date.util';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { TeamJoinStatus } from '../players/team-join-status.enum';
import { PlayersService } from '../players/players.service';
import { Player } from '../players/entities/player.entity';
import { Team } from '../teams/entities/team.entity';
import { TeamPoolService } from '../team-pool/team-pool.service';
import { TeamSeasonPot } from '../team-pool/entities/team-season-pot.entity';
import { TrainingLogEntry } from '../training-logs/entities/training-log-entry.entity';
import {
  Challenge,
  ChallengeStatus,
} from '../challenges/entities/challenge.entity';
import { CreateWeeklyGoalDto } from './dto/create-weekly-goal.dto';
import { UpdateWeeklyGoalDto } from './dto/update-weekly-goal.dto';
import {
  ACTIVITY_TYPE_BY_TARGET_METRIC,
  TARGET_UNIT_BY_TARGET_METRIC,
} from './weekly-goal-target-metric.enum';
import { isLegalWeeklyGoalTransition } from './weekly-goal-transition.util';

const ONE_ACTIVE_GOAL_PER_TEAM_CONSTRAINT =
  'idx_challenge_one_active_goal_per_team';

function assertValidTransition(
  from: ChallengeStatus,
  to: ChallengeStatus,
): void {
  if (!isLegalWeeklyGoalTransition(from, to)) {
    throw new InvalidChallengeTransitionException();
  }
}

function isActiveGoalUniqueViolation(error: unknown): boolean {
  return isPostgresUniqueViolation(error, ONE_ACTIVE_GOAL_PER_TEAM_CONSTRAINT);
}

// docs/adr/0015-weekly-goal-per-player-completion.md Decision 3 — every
// current roster member appears here, eligible or not (excluded players
// stay in the list with `eligible: false`, so a captain/teammate looking
// at "4 of 6 done" can see who's missing, not just a shorter list).
export interface PlayerGoalProgress {
  playerId: string;
  screenName: string;
  avatarId: string;
  eligible: boolean;
  // Captain-only (ADR-0015 Decision 4 — a real privacy finding, mirrors
  // PlayersService.getRoster's existing captain-only consentStatus gating).
  // Always null for a non-captain viewer, regardless of the real reason,
  // including for excluded players. `eligible: false` itself stays visible
  // to everyone; only the *why* is gated.
  exclusionReason:
    | 'joined_after_start'
    | 'consent_pending'
    | 'consent_revoked'
    | 'team_join_pending'
    | null;
  progressValue: number; // minutes or session count, per targetUnit
  goalMet: boolean; // always false when eligible is false
}

export interface GoalProgressSummary {
  id: string;
  teamId: string;
  title: string;
  description: string;
  targetMetric: string;
  targetValue: number;
  startDate: string;
  endDate: string;
  status: ChallengeStatus;
  // Nullable since docs/adr/0013-account-erasure.md Decision 6 — set null
  // once the authoring captain's own account is erased (the goal itself,
  // and any bonus already awarded from it, outlives them).
  createdByPlayerId: string | null;
  // ADR-0015 Decision 3 — derived from TARGET_UNIT_BY_TARGET_METRIC, saves
  // the client its own copy of that lookup table.
  targetUnit: 'minutes' | 'sessions';
  players: PlayerGoalProgress[];
  eligiblePlayerCount: number;
  completedPlayerCount: number;
  // MEANING CHANGED by ADR-0015 Decision 2: no longer "team-wide pooled
  // total >= targetValue" — now "every eligible current roster member
  // individually reached targetValue" (false, never vacuously true, when
  // eligiblePlayerCount is 0).
  goalMet: boolean;
  // MEANING CHANGED by ADR-0015 Decision 3:
  // completedPlayerCount / eligiblePlayerCount * 100, 0 if
  // eligiblePlayerCount is 0 — no longer a share of a team-wide pooled
  // total.
  percentComplete: number;
  // RENAMED from progressMinutes (ADR-0015 Decision 3) — a deliberate
  // breaking rename, not additive: this is the bonus-payout basis only
  // (team-wide minutes logged toward this metric/date-range), it no longer
  // decides goalMet, and an old client should fail a type check rather
  // than silently render this number under the old, now-misleading label.
  teamBonusBasisMinutes: number;
  bonusAwardedAt: string | null;
  bonusPointsAwarded: number | null;
}

// docs/api/phase2-contract.md endpoints 5/6 (POST/PATCH weekly-goal):
// "no progress fields yet at creation... GET endpoints below always
// include progress" — PATCH's response is spec'd as "same shape as
// endpoint 5's response", so it's this narrower shape too, not
// GoalProgressSummary. Kept as a distinct type (not just "GoalProgressSummary
// minus some fields" via Omit) so a future field added to one doesn't
// silently leak into the other.
export interface WeeklyGoalRow {
  id: string;
  teamId: string;
  // See GoalProgressSummary.createdByPlayerId's comment.
  createdByPlayerId: string | null;
  title: string;
  description: string;
  targetMetric: string;
  targetValue: number;
  startDate: string;
  endDate: string;
  status: ChallengeStatus;
}

function toWeeklyGoalRow(goal: Challenge): WeeklyGoalRow {
  return {
    id: goal.id,
    teamId: goal.teamId,
    createdByPlayerId: goal.createdByPlayerId,
    title: goal.title,
    description: goal.description,
    targetMetric: goal.targetMetric,
    targetValue: goal.targetValue,
    startDate: goal.startDate,
    endDate: goal.endDate,
    status: goal.status,
  };
}

export interface RosterEntry {
  playerId: string;
  screenName: string;
  avatarId: string;
  consentStatus: ParentalConsentStatus;
  lastTrainedDate: string | null;
  // ADR-0006 Decision 2 — additive, non-breaking: a captain no longer needs
  // a second call (the teammates endpoint) to confirm their own status.
  isCaptain: boolean;
}

export interface DashboardResponse {
  viewerIsCaptain: boolean;
  // Added 2026-07-26 for the "invite a friend" share feature (Laget tab) —
  // previously the invite code was only ever visible once, in the
  // account-creation response, with no way to retrieve it again
  // afterward, not even for the captain. Not captain-gated: any team
  // member sharing the code with a friend is the same trust level as the
  // code already being handed out by word of mouth/a coach.
  inviteCode: string;
  // Same addition, same reason — the share message reads better with the
  // team's actual name ("Gå med i IBK Falken P13!") than just its code.
  teamName: string;
  roster: {
    totalCount: number;
    approvedCount: number;
    pendingCount: number;
    revokedCount: number;
  };
  // Fas 2.7 (ADR-0008 Decision 4): goalThreshold/percentComplete removed —
  // there's no fixed maximum to be a percentage of anymore. rank/teamCount
  // replace it, computed by the same shared TeamPoolService query the
  // leaderboard endpoint and GET /players/me both reuse.
  teamPool: {
    seasonId: string;
    seasonLabel: string;
    pointsTotal: number;
    status: string;
    rank: number;
    teamCount: number;
    last7DaysLoggedCount: number;
  };
  weeklyGoal: {
    // docs/api/phase2-contract.md endpoint 1's example intentionally omits
    // createdByPlayerId/bonusPointsAwarded from the dashboard's `current`
    // block (unlike endpoints 7/8, which do include bonusPointsAwarded) —
    // matched exactly here rather than a superset, to avoid contract drift.
    // ADR-0015 Decision 3 keeps this same field-inclusion policy: every new
    // field it adds to GoalProgressSummary (targetUnit/players/
    // eligiblePlayerCount/completedPlayerCount/teamBonusBasisMinutes) is
    // included here too, since the dashboard is exactly where the
    // per-teammate view needs to render.
    current: Omit<
      GoalProgressSummary,
      'createdByPlayerId' | 'teamId' | 'bonusPointsAwarded'
    > | null;
    pastCount: { completed: number; cancelled: number };
  };
}

// Fas 2.7 (ADR-0008 Decision 3, docs/api/phase2.7-contract.md endpoint 1).
export interface LeaderboardEntry {
  rank: number;
  teamId: string;
  teamName: string;
  pointsTotal: number;
  isRequestingTeam: boolean;
}

export interface LeaderboardResponse {
  requestingTeam: {
    teamId: string;
    teamName: string;
    pointsTotal: number;
    rank: number;
  } | null;
  leaderboard: LeaderboardEntry[];
}

function percentOf(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  // One decimal place, matching docs/api/phase2-contract.md's weekly-goal
  // progress examples (this is the goal-progress percentage, unrelated to
  // the team-pool "percent toward a threshold" framing Fas 2.7 removed —
  // see ADR-0008 Decision 4).
  return Math.round((numerator / denominator) * 1000) / 10;
}

// Owns the "veckans mål" (weekly team goal) CRUD/state-machine, the
// team-wide progress aggregate, and the goal-completion bonus mechanic —
// docs/adr/0005-kapten-and-weekly-team-goal.md. Reuses the Challenge
// entity/table (see that entity's class comment) rather than a new one.
// The captain/team-membership checks (PlayersService.assertTeamMembership/
// assertIsCaptainOfTeam) are called from here, not the controller, so
// authorization lives next to the business rules it guards — matching how
// TrainingLogsService already does its own consent check.
@Injectable()
export class WeeklyGoalService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly playersService: PlayersService,
    private readonly teamPoolService: TeamPoolService,
    @InjectRepository(Challenge)
    private readonly challengeRepository: Repository<Challenge>,
    @InjectRepository(TrainingLogEntry)
    private readonly trainingLogEntryRepository: Repository<TrainingLogEntry>,
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    // ADR-0015 Decision 5 — a second, narrow handle on Player (alongside
    // PlayersService's own) so the eligible-roster query can run against
    // the *same* manager as processGoalBonusForLog's row-locked
    // transaction; see weekly-goal.module.ts's comment.
    @InjectRepository(Player)
    private readonly playerRepository: Repository<Player>,
  ) {}

  /**
   * ADR-0005 Decision 2's progress formula:
   * SUM(duration_minutes) WHERE team_id = :teamId
   *   AND logged_at's Europe/Stockholm calendar date BETWEEN start/end
   *   AND (targetMetric = total-minuter OR activityType matches).
   * Computed live from TrainingLogEntry, no challenge_id tagging involved.
   * Shared by every caller that needs this number (dashboard, the two GET
   * weekly-goal endpoints, and the bonus check inside
   * TrainingLogsService's transaction) rather than four slightly different
   * queries, per the contract's implementer note. The day-boundary uses
   * `AT TIME ZONE 'Europe/Stockholm'` (not a bare `::date` cast, which
   * would use the DB session's own timezone) to match every other
   * day-boundary rule in this app (see stockholm-date.util.ts).
   */
  async computeTeamProgress(
    manager: EntityManager | undefined,
    teamId: string,
    targetMetric: string,
    startDate: string,
    endDate: string,
  ): Promise<number> {
    const repository = manager
      ? manager.getRepository(TrainingLogEntry)
      : this.trainingLogEntryRepository;

    const qb = repository
      .createQueryBuilder('log')
      .select('COALESCE(SUM(log.duration_minutes), 0)', 'sum')
      .where('log.team_id = :teamId', { teamId })
      .andWhere(
        "(log.logged_at AT TIME ZONE 'Europe/Stockholm')::date BETWEEN :startDate AND :endDate",
        { startDate, endDate },
      );

    const activityType =
      ACTIVITY_TYPE_BY_TARGET_METRIC[
        targetMetric as keyof typeof ACTIVITY_TYPE_BY_TARGET_METRIC
      ];
    if (activityType) {
      qb.andWhere('log.activity_type = :activityType', { activityType });
    }

    const raw = await qb.getRawOne<{ sum: string }>();
    return Number(raw?.sum ?? 0);
  }

  /**
   * docs/adr/0015-weekly-goal-per-player-completion.md Decision 2/5 — the
   * per-player counterpart to computeTeamProgress: `GROUP BY player_id`,
   * summed or counted per `TARGET_UNIT_BY_TARGET_METRIC[targetMetric]`,
   * same team/date-range/activity-type filters. "Session count" means
   * number of qualifying TrainingLogEntry rows, not distinct days.
   */
  private async computePerPlayerProgress(
    manager: EntityManager | undefined,
    teamId: string,
    targetMetric: string,
    startDate: string,
    endDate: string,
  ): Promise<Map<string, number>> {
    const repository = manager
      ? manager.getRepository(TrainingLogEntry)
      : this.trainingLogEntryRepository;

    const targetUnit =
      TARGET_UNIT_BY_TARGET_METRIC[
        targetMetric as keyof typeof TARGET_UNIT_BY_TARGET_METRIC
      ];
    const valueExpression =
      targetUnit === 'sessions'
        ? 'COUNT(*)'
        : 'COALESCE(SUM(log.duration_minutes), 0)';

    const qb = repository
      .createQueryBuilder('log')
      .select('log.player_id', 'playerId')
      .addSelect(valueExpression, 'value')
      .where('log.team_id = :teamId', { teamId })
      .andWhere(
        "(log.logged_at AT TIME ZONE 'Europe/Stockholm')::date BETWEEN :startDate AND :endDate",
        { startDate, endDate },
      )
      .groupBy('log.player_id');

    const activityType =
      ACTIVITY_TYPE_BY_TARGET_METRIC[
        targetMetric as keyof typeof ACTIVITY_TYPE_BY_TARGET_METRIC
      ];
    if (activityType) {
      qb.andWhere('log.activity_type = :activityType', { activityType });
    }

    const rows = await qb.getRawMany<{ playerId: string; value: string }>();
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.playerId, Number(row.value));
    }
    return map;
  }

  /**
   * docs/adr/0015-weekly-goal-per-player-completion.md Decision 2's
   * eligible-roster predicate: a player could plausibly have logged
   * anything toward this goal only if their consent AND team-join are both
   * approved AND they joined on/before the goal's startDate — a direct
   * consequence of TrainingLogsService.logTraining already refusing to log
   * training at all otherwise. Priority among reasons (checked in this
   * order) only matters for which single reason is reported when more than
   * one applies; it doesn't affect `eligible` itself.
   */
  private computeExclusionReason(
    player: Player,
    goalStartDate: string,
  ): PlayerGoalProgress['exclusionReason'] {
    if (player.parentalConsentStatus === ParentalConsentStatus.REVOKED) {
      return 'consent_revoked';
    }
    if (player.parentalConsentStatus !== ParentalConsentStatus.APPROVED) {
      return 'consent_pending';
    }
    if (player.teamJoinStatus !== TeamJoinStatus.APPROVED) {
      return 'team_join_pending';
    }
    if (stockholmDateString(player.createdAt) > goalStartDate) {
      return 'joined_after_start';
    }
    return null;
  }

  /**
   * docs/adr/0015-weekly-goal-per-player-completion.md Decision 2/5's core
   * algorithm — live query against the current Player table (re-run every
   * time, so a departed/erased player just stops appearing, per the ADR's
   * "Departed/erased players" section) plus the per-player progress map.
   * `goalMet` is explicitly `false` when `eligiblePlayerCount` is 0 — the
   * required vacuous-truth guard, never true for "0 of 0 players done."
   * Shared by buildGoalProgressSummary (the read paths) and
   * processGoalBonusForLog (the bonus check), always against the same
   * `manager` as the caller so both see a consistent snapshot.
   */
  private async buildPlayerGoalProgress(
    manager: EntityManager | undefined,
    goal: Challenge,
  ): Promise<{
    players: PlayerGoalProgress[];
    eligiblePlayerCount: number;
    completedPlayerCount: number;
    goalMet: boolean;
  }> {
    const repository = manager
      ? manager.getRepository(Player)
      : this.playerRepository;
    const rosterPlayers = await repository.find({
      where: { teamId: goal.teamId },
    });

    const progressMap = await this.computePerPlayerProgress(
      manager,
      goal.teamId,
      goal.targetMetric,
      goal.startDate,
      goal.endDate,
    );

    const players: PlayerGoalProgress[] = rosterPlayers.map((player) => {
      const exclusionReason = this.computeExclusionReason(
        player,
        goal.startDate,
      );
      const eligible = exclusionReason === null;
      const progressValue = progressMap.get(player.id) ?? 0;
      return {
        playerId: player.id,
        screenName: player.screenName,
        avatarId: player.avatarId,
        eligible,
        exclusionReason,
        progressValue,
        goalMet: eligible && progressValue >= goal.targetValue,
      };
    });

    const eligiblePlayers = players.filter((p) => p.eligible);
    const eligiblePlayerCount = eligiblePlayers.length;
    const completedPlayerCount = eligiblePlayers.filter(
      (p) => p.goalMet,
    ).length;
    // Vacuous-truth guard: an empty eligible roster must never read as
    // "complete."
    const goalMet =
      eligiblePlayerCount > 0 && eligiblePlayers.every((p) => p.goalMet);

    return { players, eligiblePlayerCount, completedPlayerCount, goalMet };
  }

  private async buildGoalProgressSummary(
    goal: Challenge,
    viewerIsCaptain: boolean,
  ): Promise<GoalProgressSummary> {
    const teamBonusBasisMinutes = await this.computeTeamProgress(
      undefined,
      goal.teamId,
      goal.targetMetric,
      goal.startDate,
      goal.endDate,
    );
    const { players, eligiblePlayerCount, completedPlayerCount, goalMet } =
      await this.buildPlayerGoalProgress(undefined, goal);
    // ADR-0015 Decision 4 — captain-only exclusionReason; eligible: false
    // itself stays visible to everyone.
    const visiblePlayers = viewerIsCaptain
      ? players
      : players.map((player) => ({ ...player, exclusionReason: null }));
    const targetUnit =
      TARGET_UNIT_BY_TARGET_METRIC[
        goal.targetMetric as keyof typeof TARGET_UNIT_BY_TARGET_METRIC
      ];

    return {
      id: goal.id,
      teamId: goal.teamId,
      title: goal.title,
      description: goal.description,
      targetMetric: goal.targetMetric,
      targetValue: goal.targetValue,
      startDate: goal.startDate,
      endDate: goal.endDate,
      status: goal.status,
      createdByPlayerId: goal.createdByPlayerId,
      targetUnit,
      players: visiblePlayers,
      eligiblePlayerCount,
      completedPlayerCount,
      percentComplete: percentOf(completedPlayerCount, eligiblePlayerCount),
      goalMet,
      teamBonusBasisMinutes,
      bonusAwardedAt: goal.goalBonusAwardedAt
        ? goal.goalBonusAwardedAt.toISOString()
        : null,
      bonusPointsAwarded: goal.goalBonusPointsAwarded,
    };
  }

  /**
   * docs/api/phase2-contract.md endpoint 1/7: "current" is the team's
   * active goal, or — if there is none — the most recently created draft
   * (so a captain resuming the builder doesn't need a second call). Null
   * if neither exists. Challenge has no createdAt column (Phase 1 never
   * added one, and ADR-0005 didn't ask for one) — ties among multiple
   * drafts are broken arbitrarily; flagged as a minor judgment call, not
   * expected to matter at this project's scale (a team has "a handful" of
   * these, per the contract's history-endpoint note).
   */
  private async findCurrentGoalForTeam(
    teamId: string,
  ): Promise<Challenge | null> {
    const active = await this.challengeRepository.findOne({
      where: { teamId, status: ChallengeStatus.ACTIVE },
    });
    if (active) return active;
    return this.challengeRepository.findOne({
      where: { teamId, status: ChallengeStatus.DRAFT },
    });
  }

  async createGoal(
    teamId: string,
    requesterId: string,
    dto: CreateWeeklyGoalDto,
  ): Promise<WeeklyGoalRow> {
    await this.playersService.assertIsCaptainOfTeam(requesterId, teamId);
    assertDateRange(dto.startDate, dto.endDate);

    if (dto.status === ChallengeStatus.ACTIVE) {
      const existingActive = await this.challengeRepository.findOne({
        where: { teamId, status: ChallengeStatus.ACTIVE },
      });
      if (existingActive) {
        throw new ActiveGoalAlreadyExistsException();
      }
    }

    const goal = this.challengeRepository.create({
      teamId,
      createdByPlayerId: requesterId,
      title: dto.title,
      description: dto.description,
      targetMetric: dto.targetMetric,
      targetValue: dto.targetValue,
      startDate: dto.startDate,
      endDate: dto.endDate,
      status: dto.status,
      goalBonusAwardedAt: null,
      goalBonusPointsAwarded: null,
    });

    let saved: Challenge;
    try {
      saved = await this.challengeRepository.save(goal);
    } catch (error) {
      if (isActiveGoalUniqueViolation(error)) {
        throw new ActiveGoalAlreadyExistsException();
      }
      throw error;
    }
    return toWeeklyGoalRow(saved);
  }

  async patchGoal(
    teamId: string,
    goalId: string,
    requesterId: string,
    dto: UpdateWeeklyGoalDto,
  ): Promise<WeeklyGoalRow> {
    await this.playersService.assertIsCaptainOfTeam(requesterId, teamId);

    const updated = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Challenge);
      const goal = await repository
        .createQueryBuilder('challenge')
        .setLock('pessimistic_write')
        .where('challenge.id = :goalId', { goalId })
        .andWhere('challenge.team_id = :teamId', { teamId })
        .getOne();
      if (!goal) {
        throw new ChallengeNotFoundException();
      }

      const currentStatus = goal.status;
      const changesFrozenFields =
        dto.targetMetric !== undefined ||
        dto.targetValue !== undefined ||
        dto.startDate !== undefined ||
        dto.endDate !== undefined;
      // Rejected even for a no-op identical value (ADR-0005: closes off a
      // captain shrinking the target mid-week to trigger the bonus early)
      // — so this is a presence check on the DTO, not a value comparison.
      if (currentStatus !== ChallengeStatus.DRAFT && changesFrozenFields) {
        throw new ChallengeTargetFrozenException();
      }

      if (dto.status !== undefined) {
        assertValidTransition(currentStatus, dto.status);
      }

      // title/description are editable at any *non-terminal* status
      // (draft/active), per ADR-0005 and phase2-contract.md — completed/
      // cancelled goals are a read-only historical record in full, not
      // just for their target/dates. Fixes a confirmed code-critic
      // finding: these two fields had no status check at all before.
      const isTerminal =
        currentStatus === ChallengeStatus.COMPLETED ||
        currentStatus === ChallengeStatus.CANCELLED;
      const changesTitleOrDescription =
        dto.title !== undefined || dto.description !== undefined;
      if (isTerminal && changesTitleOrDescription) {
        throw new ChallengeAlreadyTerminalException();
      }

      if (dto.title !== undefined) goal.title = dto.title;
      if (dto.description !== undefined) goal.description = dto.description;

      if (changesFrozenFields) {
        // currentStatus === DRAFT is guaranteed by the check above.
        if (dto.targetMetric !== undefined)
          goal.targetMetric = dto.targetMetric;
        if (dto.targetValue !== undefined) goal.targetValue = dto.targetValue;
        if (dto.startDate !== undefined) goal.startDate = dto.startDate;
        if (dto.endDate !== undefined) goal.endDate = dto.endDate;
        assertDateRange(goal.startDate, goal.endDate);
      }

      if (dto.status !== undefined) {
        if (dto.status === ChallengeStatus.ACTIVE) {
          const existingActive = await repository
            .createQueryBuilder('challenge')
            .where('challenge.team_id = :teamId', { teamId })
            .andWhere('challenge.status = :status', {
              status: ChallengeStatus.ACTIVE,
            })
            .andWhere('challenge.id != :goalId', { goalId })
            .getOne();
          if (existingActive) {
            throw new ActiveGoalAlreadyExistsException();
          }
        }
        goal.status = dto.status;
      }

      try {
        return await repository.save(goal);
      } catch (error) {
        if (isActiveGoalUniqueViolation(error)) {
          throw new ActiveGoalAlreadyExistsException();
        }
        throw error;
      }
    });

    return toWeeklyGoalRow(updated);
  }

  async getCurrentGoalForTeam(
    teamId: string,
    requesterId: string,
  ): Promise<{ goal: GoalProgressSummary | null; viewerIsCaptain: boolean }> {
    const requester = await this.playersService.assertTeamMembership(
      requesterId,
      teamId,
    );
    const goal = await this.findCurrentGoalForTeam(teamId);
    return {
      goal: goal
        ? await this.buildGoalProgressSummary(goal, requester.isCaptain)
        : null,
      viewerIsCaptain: requester.isCaptain,
    };
  }

  async getHistoryForTeam(
    teamId: string,
    requesterId: string,
  ): Promise<{ goals: GoalProgressSummary[] }> {
    const requester = await this.playersService.assertTeamMembership(
      requesterId,
      teamId,
    );
    const goals = await this.challengeRepository
      .createQueryBuilder('challenge')
      .where('challenge.team_id = :teamId', { teamId })
      .andWhere('challenge.status IN (:...statuses)', {
        statuses: [ChallengeStatus.COMPLETED, ChallengeStatus.CANCELLED],
      })
      .getMany();

    const summaries = await Promise.all(
      goals.map((goal) =>
        this.buildGoalProgressSummary(goal, requester.isCaptain),
      ),
    );
    // "Newest first" per the contract — Challenge has no createdAt, so
    // endDate is used as the best available recency proxy (flagged
    // alongside findCurrentGoalForTeam's similar judgment call).
    summaries.sort((a, b) => b.endDate.localeCompare(a.endDate));
    return { goals: summaries };
  }

  async getDashboard(
    teamId: string,
    requesterId: string,
  ): Promise<DashboardResponse> {
    const requester = await this.playersService.assertTeamMembership(
      requesterId,
      teamId,
    );
    const players = await this.playersService.listByTeam(teamId);
    const roster = summarizeRosterCounts(players);

    const pot = await this.teamPoolService.getActivePotForTeam(teamId);
    const season = await this.teamPoolService.getSeason(pot.seasonId);
    if (!season) {
      // Can't occur given the API contract (every TeamSeasonPot is seeded
      // with a real Season) — surfaced as a 500 rather than defended
      // against as if it were normal client input, same posture as
      // PlayersController.getMe's equivalent check.
      throw new Error(
        `TeamSeasonPot ${pot.id} references missing season ${pot.seasonId}`,
      );
    }
    const { rank, teamCount } =
      await this.teamPoolService.getRankAndTeamCountOrThrow(teamId);
    const last7DaysLoggedCount = await this.countRecentLogs(teamId, 7);

    const team = await this.teamRepository.findOne({ where: { id: teamId } });
    if (!team) {
      // Can't occur — assertTeamMembership above already confirms this
      // team exists (a player's teamId is a real FK), same "can't occur
      // given the contract" posture as this method's other invariant
      // checks.
      throw new Error(`Team ${teamId} not found despite active membership`);
    }

    const currentGoal = await this.findCurrentGoalForTeam(teamId);
    const pastCount = await this.countPastGoals(teamId);

    let current: DashboardResponse['weeklyGoal']['current'] = null;
    if (currentGoal) {
      const summary = await this.buildGoalProgressSummary(
        currentGoal,
        requester.isCaptain,
      );
      // Built field-by-field (not a destructure-omit) so nothing needs an
      // unused-variable escape hatch — docs/api/phase2-contract.md endpoint
      // 1's example intentionally excludes createdByPlayerId/teamId/
      // bonusPointsAwarded from this block (unlike endpoints 7/8); every
      // other field, including ADR-0015's new ones, is included.
      current = {
        id: summary.id,
        title: summary.title,
        description: summary.description,
        targetMetric: summary.targetMetric,
        targetValue: summary.targetValue,
        startDate: summary.startDate,
        endDate: summary.endDate,
        status: summary.status,
        targetUnit: summary.targetUnit,
        players: summary.players,
        eligiblePlayerCount: summary.eligiblePlayerCount,
        completedPlayerCount: summary.completedPlayerCount,
        goalMet: summary.goalMet,
        percentComplete: summary.percentComplete,
        teamBonusBasisMinutes: summary.teamBonusBasisMinutes,
        bonusAwardedAt: summary.bonusAwardedAt,
      };
    }

    return {
      viewerIsCaptain: requester.isCaptain,
      inviteCode: team.inviteCode,
      teamName: team.name,
      roster,
      teamPool: {
        seasonId: season.id,
        seasonLabel: season.label,
        pointsTotal: pot.pointsTotal,
        status: pot.status,
        rank,
        teamCount,
        last7DaysLoggedCount,
      },
      weeklyGoal: { current, pastCount },
    };
  }

  /**
   * ADR-0008 Decision 3 / docs/api/phase2.7-contract.md endpoint 1 — the
   * requesting team's own rank plus the full sorted list, one call, no
   * second round-trip. `requestingTeam` is null if the calling team
   * currently has no active pot (more graceful than getDashboard's
   * 500-on-missing-pot posture — see the ADR).
   */
  async getLeaderboard(
    teamId: string,
    requesterId: string,
  ): Promise<LeaderboardResponse> {
    await this.playersService.assertTeamMembership(requesterId, teamId);

    const rows = await this.teamPoolService.getLeaderboard();
    const leaderboard: LeaderboardEntry[] = rows.map((row) => ({
      rank: row.rank,
      teamId: row.teamId,
      teamName: row.teamName,
      pointsTotal: row.pointsTotal,
      isRequestingTeam: row.teamId === teamId,
    }));

    const mine = leaderboard.find((row) => row.isRequestingTeam);
    return {
      requestingTeam: mine
        ? {
            teamId: mine.teamId,
            teamName: mine.teamName,
            pointsTotal: mine.pointsTotal,
            rank: mine.rank,
          }
        : null,
      leaderboard,
    };
  }

  async getRoster(teamId: string, requesterId: string): Promise<RosterEntry[]> {
    await this.playersService.assertIsCaptainOfTeam(requesterId, teamId);
    const players = await this.playersService.listByTeam(teamId);
    return players.map((player) => ({
      playerId: player.id,
      screenName: player.screenName,
      avatarId: player.avatarId,
      consentStatus: player.parentalConsentStatus,
      lastTrainedDate: player.lastTrainedDate,
      isCaptain: player.isCaptain,
    }));
  }

  private async countRecentLogs(teamId: string, days: number): Promise<number> {
    const { count } = (await this.trainingLogEntryRepository
      .createQueryBuilder('log')
      .select('COUNT(*)', 'count')
      .where('log.team_id = :teamId', { teamId })
      .andWhere('log.logged_at >= now() - make_interval(days => :days)', {
        days,
      })
      .getRawOne<{ count: string }>()) ?? { count: '0' };
    return Number(count);
  }

  private async countPastGoals(
    teamId: string,
  ): Promise<{ completed: number; cancelled: number }> {
    const rows = await this.challengeRepository
      .createQueryBuilder('challenge')
      .select('challenge.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('challenge.team_id = :teamId', { teamId })
      .andWhere('challenge.status IN (:...statuses)', {
        statuses: [ChallengeStatus.COMPLETED, ChallengeStatus.CANCELLED],
      })
      .groupBy('challenge.status')
      .getRawMany<{ status: ChallengeStatus; count: string }>();

    const counts = { completed: 0, cancelled: 0 };
    for (const row of rows) {
      if (row.status === ChallengeStatus.COMPLETED)
        counts.completed = Number(row.count);
      if (row.status === ChallengeStatus.CANCELLED)
        counts.cancelled = Number(row.count);
    }
    return counts;
  }

  /**
   * The core Phase 2 mechanic — ADR-0005 Decision 3, called from
   * TrainingLogsService.logTraining's existing transaction, after the new
   * TrainingLogEntry row is inserted and the base team-pool points are
   * added, using the *same* manager (so the just-inserted log is visible
   * to the progress query below, and the row lock below serializes any
   * concurrent training-log write for the same team).
   *
   * Crossing predicate revised by
   * docs/adr/0015-weekly-goal-per-player-completion.md Decision 2/5: no
   * longer a team-wide pooled-total check — every *eligible* current
   * roster member must individually reach targetValue (vacuous-truth
   * guarded: an empty eligible roster never counts as met). The lump-sum
   * payout formula/transaction/idempotency flag below are unchanged; only
   * this predicate changed.
   *
   * Returns null whenever there's nothing new to report (no active goal,
   * this log's date is out of range, the goal was already met by an
   * earlier log, or the per-player check still falls short) — folding
   * "already met" into the same null case as "not met yet" is deliberate,
   * per the contract: a non-null result unambiguously means "this log just
   * caused the one-time crossing."
   */
  async processGoalBonusForLog(
    manager: EntityManager,
    teamId: string,
    teamSeasonPotId: string,
    loggedDateString: string,
  ): Promise<{ awardedPoints: number; updatedPot: TeamSeasonPot } | null> {
    const challengeRepository = manager.getRepository(Challenge);

    // Row-locked read: at most one row can match (the partial unique index
    // from ADR-0005 Decision 2), so this is a cheap indexed lookup whose
    // lock also naturally serializes two concurrent training-log writes
    // for the same team racing on the crossing check below.
    const activeGoal = await challengeRepository
      .createQueryBuilder('challenge')
      .setLock('pessimistic_write')
      .where('challenge.team_id = :teamId', { teamId })
      .andWhere('challenge.status = :status', {
        status: ChallengeStatus.ACTIVE,
      })
      .getOne();

    if (!activeGoal) return null;
    if (
      loggedDateString < activeGoal.startDate ||
      loggedDateString > activeGoal.endDate
    ) {
      return null;
    }
    if (activeGoal.goalBonusAwardedAt !== null) return null;

    // ADR-0015 Decision 5 steps 3-4: eligible roster + per-player progress
    // (same manager, so this sees the just-inserted log), then the
    // per-player crossing check. `goalMet` here already folds in the
    // vacuous-truth guard (false when eligiblePlayerCount is 0).
    const { goalMet } = await this.buildPlayerGoalProgress(manager, activeGoal);
    if (!goalMet) return null;

    // Step 5: bonus basis is still the team-wide-minutes aggregate,
    // unchanged (ADR-0015 Decision 2 keeps the payout formula/basis as-is
    // — only the crossing predicate above changed).
    const teamBonusBasisMinutes = await this.computeTeamProgress(
      manager,
      teamId,
      activeGoal.targetMetric,
      activeGoal.startDate,
      activeGoal.endDate,
    );

    // Flat +5, plus 1 point per team-wide minute — a one-time lump sum
    // (ADR-0005 Decision 3, corrected 2026-07-05), not a per-log/ongoing
    // bonus.
    const awardedPoints = 5 + teamBonusBasisMinutes;
    const updatedPot = await this.teamPoolService.addPoints(
      manager,
      teamSeasonPotId,
      awardedPoints,
    );
    await challengeRepository.update(
      { id: activeGoal.id },
      { goalBonusAwardedAt: new Date(), goalBonusPointsAwarded: awardedPoints },
    );

    return { awardedPoints, updatedPot };
  }
}

function assertDateRange(startDate: string, endDate: string): void {
  if (endDate <= startDate) {
    throw new BadRequestException('endDate must be after startDate.');
  }
}

function summarizeRosterCounts(players: Player[]): DashboardResponse['roster'] {
  return {
    totalCount: players.length,
    approvedCount: players.filter(
      (p) => p.parentalConsentStatus === ParentalConsentStatus.APPROVED,
    ).length,
    pendingCount: players.filter(
      (p) => p.parentalConsentStatus === ParentalConsentStatus.PENDING,
    ).length,
    revokedCount: players.filter(
      (p) => p.parentalConsentStatus === ParentalConsentStatus.REVOKED,
    ).length,
  };
}
