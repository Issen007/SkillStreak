import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { computeStreakUpdate } from '../common/streak/streak.util';
import { ConsentRequiredException } from '../common/errors/exceptions';
import { stockholmDateString } from '../common/time/stockholm-date.util';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { PlayersService } from '../players/players.service';
import { RedisService } from '../redis/redis.service';
import { TeamPoolService } from '../team-pool/team-pool.service';
import { WeeklyGoalService } from '../weekly-goal/weekly-goal.service';
import { CreateTrainingLogDto } from './dto/create-training-log.dto';
import { TrainingLogEntry } from './entities/training-log-entry.entity';
import { pointsForTrainingLog } from './points.util';

export interface TrainingLogResponse {
  trainingLogId: string;
  loggedAt: string;
  streak: {
    currentStreakCount: number;
    longestStreakCount: number;
    alreadyLoggedToday: boolean;
  };
  teamPool: {
    pointsTotal: number;
    goalThreshold: number;
    percentComplete: number;
  };
  // NEW in Phase 2 (docs/api/phase2-contract.md, ADR-0005 Decision 3): only
  // non-null on the one log whose insertion caused the team to cross its
  // active weekly goal's target for the first (and only) time.
  goalBonus: { awardedPoints: number } | null;
}

// The "Jag har tränat" core loop. Follows ADR-0002's mandated write order:
// Postgres transaction (TrainingLogEntry insert + Player streak fields +
// TeamSeasonPot.points_total, all-or-nothing) commits first, then Redis is
// updated. The consent check happens before the transaction opens, per
// docs/api/phase1-contract.md's implementer note.
@Injectable()
export class TrainingLogsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly playersService: PlayersService,
    private readonly teamPoolService: TeamPoolService,
    private readonly weeklyGoalService: WeeklyGoalService,
    private readonly redisService: RedisService,
    @InjectRepository(TrainingLogEntry)
    private readonly trainingLogEntryRepository: Repository<TrainingLogEntry>,
  ) {}

  async logTraining(
    playerId: string,
    dto: CreateTrainingLogDto,
  ): Promise<TrainingLogResponse> {
    // Pre-transaction consent check (ADR-0002 addendum §2 / the contract's
    // implementer note: "before that transaction starts, not after").
    const player = await this.playersService.findByIdOrThrow(playerId);
    assertConsentApproved(player.parentalConsentStatus);

    const today = stockholmDateString();

    const { trainingLog, streakUpdate, updatedPot, goalBonus } =
      await this.dataSource.transaction(async (manager) => {
        // Row-locked re-read: guards against a consent revocation racing in
        // between the check above and this transaction, and serializes
        // concurrent same-day requests for this player so the streak
        // transition below can't be lost to a race.
        const lockedPlayer = await this.playersService.findByIdForUpdate(
          manager,
          playerId,
        );
        assertConsentApproved(lockedPlayer.parentalConsentStatus);

        const streakUpdate = computeStreakUpdate(
          {
            currentStreakCount: lockedPlayer.currentStreakCount,
            longestStreakCount: lockedPlayer.longestStreakCount,
            lastTrainedDate: lockedPlayer.lastTrainedDate,
          },
          today,
        );

        const trainingLogRepository = manager.getRepository(TrainingLogEntry);
        const trainingLog = await trainingLogRepository.save(
          trainingLogRepository.create({
            playerId,
            teamId: lockedPlayer.teamId,
            loggedAt: new Date(),
            activityType: dto.activityType,
            durationMinutes: dto.durationMinutes,
            challengeId: dto.challengeId ?? null,
          }),
        );

        // Streak fields only change on the first log of a new day — a repeat
        // same-day log still contributes to the team pool below, but leaves
        // Player.current_streak_count/longest_streak_count/last_trained_date
        // untouched, per the contract's same-day-logging rule.
        if (!streakUpdate.alreadyLoggedToday) {
          await this.playersService.updateStreakFields(manager, playerId, {
            currentStreakCount: streakUpdate.currentStreakCount,
            longestStreakCount: streakUpdate.longestStreakCount,
            lastTrainedDate: streakUpdate.lastTrainedDate as string,
          });
        }

        const pot = await this.teamPoolService.getActivePotForTeam(
          lockedPlayer.teamId,
          manager,
        );
        let updatedPot = await this.teamPoolService.addPoints(
          manager,
          pot.id,
          pointsForTrainingLog(dto.durationMinutes),
        );

        // ADR-0005 Decision 3: the goal-completion bonus, checked
        // opportunistically in the same transaction, after the base points
        // above — row-locks the team's active goal (if any), so this also
        // serializes concurrent training-log writes for the same team
        // around the crossing check.
        const goalBonusResult =
          await this.weeklyGoalService.processGoalBonusForLog(
            manager,
            lockedPlayer.teamId,
            pot.id,
            stockholmDateString(trainingLog.loggedAt),
          );
        let goalBonus: { awardedPoints: number } | null = null;
        if (goalBonusResult) {
          updatedPot = goalBonusResult.updatedPot;
          goalBonus = { awardedPoints: goalBonusResult.awardedPoints };
        }

        return { trainingLog, streakUpdate, updatedPot, goalBonus };
      });

    // Redis updated only after the Postgres transaction has committed, per
    // ADR-0002's write-path pattern — safe to lose/rebuild, never the only
    // copy of anything.
    await this.redisService.markLoggedToday(playerId, today);
    await this.redisService.setTeamPoolGauge(
      updatedPot.id,
      updatedPot.pointsTotal,
    );
    await this.redisService.updateLeaderboard(
      trainingLog.teamId,
      playerId,
      streakUpdate.currentStreakCount,
    );

    return {
      trainingLogId: trainingLog.id,
      loggedAt: trainingLog.loggedAt.toISOString(),
      streak: {
        currentStreakCount: streakUpdate.currentStreakCount,
        longestStreakCount: streakUpdate.longestStreakCount,
        alreadyLoggedToday: streakUpdate.alreadyLoggedToday,
      },
      teamPool: {
        pointsTotal: updatedPot.pointsTotal,
        goalThreshold: updatedPot.goalThreshold,
        percentComplete: TeamPoolService.percentComplete(
          updatedPot.pointsTotal,
          updatedPot.goalThreshold,
        ),
      },
      goalBonus,
    };
  }
}

function assertConsentApproved(status: ParentalConsentStatus): void {
  if (status !== ParentalConsentStatus.APPROVED) {
    throw new ConsentRequiredException();
  }
}
