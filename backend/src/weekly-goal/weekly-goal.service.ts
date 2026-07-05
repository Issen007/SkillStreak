import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  ActiveGoalAlreadyExistsException,
  ChallengeNotFoundException,
  ChallengeTargetFrozenException,
  InvalidChallengeTransitionException,
} from '../common/errors/exceptions';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { PlayersService } from '../players/players.service';
import { Player } from '../players/entities/player.entity';
import { TeamPoolService } from '../team-pool/team-pool.service';
import { TeamSeasonPot } from '../team-pool/entities/team-season-pot.entity';
import { TrainingLogEntry } from '../training-logs/entities/training-log-entry.entity';
import {
  Challenge,
  ChallengeStatus,
} from '../challenges/entities/challenge.entity';
import { CreateWeeklyGoalDto } from './dto/create-weekly-goal.dto';
import { UpdateWeeklyGoalDto } from './dto/update-weekly-goal.dto';
import { ACTIVITY_TYPE_BY_TARGET_METRIC } from './weekly-goal-target-metric.enum';
import { isLegalWeeklyGoalTransition } from './weekly-goal-transition.util';

const POSTGRES_UNIQUE_VIOLATION = '23505';
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
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const pgError = error as { code?: string; constraint?: string };
  return (
    pgError.code === POSTGRES_UNIQUE_VIOLATION &&
    pgError.constraint === ONE_ACTIVE_GOAL_PER_TEAM_CONSTRAINT
  );
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
  createdByPlayerId: string;
  progressMinutes: number;
  percentComplete: number;
  goalMet: boolean;
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
  createdByPlayerId: string;
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
}

export interface DashboardResponse {
  viewerIsCaptain: boolean;
  roster: {
    totalCount: number;
    approvedCount: number;
    pendingCount: number;
    revokedCount: number;
  };
  teamPool: {
    seasonId: string;
    seasonLabel: string;
    pointsTotal: number;
    goalThreshold: number;
    percentComplete: number;
    status: string;
    last7DaysLoggedCount: number;
  };
  weeklyGoal: {
    // docs/api/phase2-contract.md endpoint 1's example intentionally omits
    // createdByPlayerId/bonusPointsAwarded from the dashboard's `current`
    // block (unlike endpoints 7/8, which do include bonusPointsAwarded) —
    // matched exactly here rather than a superset, to avoid contract drift.
    current: Omit<
      GoalProgressSummary,
      'createdByPlayerId' | 'teamId' | 'bonusPointsAwarded'
    > | null;
    pastCount: { completed: number; cancelled: number };
  };
}

function percentOf(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  // One decimal place, matching TeamPoolService.percentComplete's contract
  // example (25.6) and docs/api/phase2-contract.md's weekly-goal examples.
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

  private async buildGoalProgressSummary(
    goal: Challenge,
  ): Promise<GoalProgressSummary> {
    const progressMinutes = await this.computeTeamProgress(
      undefined,
      goal.teamId,
      goal.targetMetric,
      goal.startDate,
      goal.endDate,
    );
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
      progressMinutes,
      percentComplete: percentOf(progressMinutes, goal.targetValue),
      goalMet: progressMinutes >= goal.targetValue,
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
      goal: goal ? await this.buildGoalProgressSummary(goal) : null,
      viewerIsCaptain: requester.isCaptain,
    };
  }

  async getHistoryForTeam(
    teamId: string,
    requesterId: string,
  ): Promise<{ goals: GoalProgressSummary[] }> {
    await this.playersService.assertTeamMembership(requesterId, teamId);
    const goals = await this.challengeRepository
      .createQueryBuilder('challenge')
      .where('challenge.team_id = :teamId', { teamId })
      .andWhere('challenge.status IN (:...statuses)', {
        statuses: [ChallengeStatus.COMPLETED, ChallengeStatus.CANCELLED],
      })
      .getMany();

    const summaries = await Promise.all(
      goals.map((goal) => this.buildGoalProgressSummary(goal)),
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
    const last7DaysLoggedCount = await this.countRecentLogs(teamId, 7);

    const currentGoal = await this.findCurrentGoalForTeam(teamId);
    const pastCount = await this.countPastGoals(teamId);

    let current: DashboardResponse['weeklyGoal']['current'] = null;
    if (currentGoal) {
      const summary = await this.buildGoalProgressSummary(currentGoal);
      // Built field-by-field (not a destructure-omit) so nothing needs an
      // unused-variable escape hatch — docs/api/phase2-contract.md endpoint
      // 1's example intentionally excludes createdByPlayerId/teamId/
      // bonusPointsAwarded from this block (unlike endpoints 7/8).
      current = {
        id: summary.id,
        title: summary.title,
        description: summary.description,
        targetMetric: summary.targetMetric,
        targetValue: summary.targetValue,
        startDate: summary.startDate,
        endDate: summary.endDate,
        status: summary.status,
        progressMinutes: summary.progressMinutes,
        percentComplete: summary.percentComplete,
        goalMet: summary.goalMet,
        bonusAwardedAt: summary.bonusAwardedAt,
      };
    }

    return {
      viewerIsCaptain: requester.isCaptain,
      roster,
      teamPool: {
        seasonId: season.id,
        seasonLabel: season.label,
        pointsTotal: pot.pointsTotal,
        goalThreshold: pot.goalThreshold,
        percentComplete: TeamPoolService.percentComplete(
          pot.pointsTotal,
          pot.goalThreshold,
        ),
        status: pot.status,
        last7DaysLoggedCount,
      },
      weeklyGoal: { current, pastCount },
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
   * Returns null whenever there's nothing new to report (no active goal,
   * this log's date is out of range, the goal was already met by an
   * earlier log, or progress still falls short) — folding "already met"
   * into the same null case as "not met yet" is deliberate, per the
   * contract: a non-null result unambiguously means "this log just caused
   * the one-time crossing."
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

    const progress = await this.computeTeamProgress(
      manager,
      teamId,
      activeGoal.targetMetric,
      activeGoal.startDate,
      activeGoal.endDate,
    );

    if (progress < activeGoal.targetValue) return null;

    // Flat +5, plus 1 point per team-wide minute — a one-time lump sum
    // (ADR-0005 Decision 3, corrected 2026-07-05), not a per-log/ongoing
    // bonus. `progress` is the same number just computed for the target
    // check, not a separate query.
    const awardedPoints = 5 + progress;
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
