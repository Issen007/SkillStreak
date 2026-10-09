import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  computeStreakUpdate,
  streakSaverCoveredDates,
} from '../common/streak/streak.util';
import {
  stockholmDateString,
  stockholmWeekBounds,
} from '../common/time/stockholm-date.util';
import { PlayersService } from '../players/players.service';
import { RedisService } from '../redis/redis.service';
import { TeamPoolService } from '../team-pool/team-pool.service';
import { WeeklyGoalService } from '../weekly-goal/weekly-goal.service';
import { CreateTrainingLogDto } from './dto/create-training-log.dto';
import { TrainingLogEntry } from './entities/training-log-entry.entity';
import { TrainingTimer } from './entities/training-timer.entity';
import {
  CLICK_ONLY_WEEKLY_LIMIT,
  EvidenceTier,
  pointsForTrainingLog,
} from './points.util';
import {
  assertConsentApproved,
  assertTeamJoinApproved,
} from '../players/player-access.util';
import {
  VideoClip,
  VideoClipStatus,
} from '../video-clips/entities/video-clip.entity';
import {
  EvidenceClipAlreadyUsedException,
  EvidenceClipNotUsableException,
  TrainingTimerAlreadyUsedException,
  TrainingTimerNotUsableException,
  TrainingTimerTooShortException,
} from '../common/errors/exceptions';

// docs/adr/0025 Decision 3 — how close to the session a clip has to be to
// count as proof of it. Two hours is generous for "filmed it, logged it
// afterwards" and short enough that yesterday's clip cannot be recycled.
// Flagged in the ADR as a guess rather than a researched number.
const EVIDENCE_CLIP_MAX_AGE_MS = 2 * 60 * 60 * 1000;

// docs/adr/0038 Decision 2 — "a timer older than 24 hours is unusable".
const TRAINING_TIMER_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

/**
 * docs/adr/0038 Decision 4 — how many of this week's paid click-only logs
 * the player has used. `used` never exceeds `limit`: a 5th tap in a week
 * is still "3 of 3 used", not "5 of 3". `resetsOn` is the next Monday's
 * Europe/Stockholm date, 'YYYY-MM-DD'.
 */
export interface ClickOnlyAllowance {
  used: number;
  limit: number;
  resetsOn: string;
}

export interface TrainingLogResponse {
  trainingLogId: string;
  loggedAt: string;
  streak: {
    currentStreakCount: number;
    longestStreakCount: number;
    alreadyLoggedToday: boolean;
    // docs/adr/0024-streak-savers.md API sketch — additive.
    bankedStreakSaverCount: number; // post-transaction balance
    streakSaverSpent: number; // 0 normally; >0 = the "streak saved!" moment
    streakSaverEarned: boolean;
  };
  // Fas 2.7 (ADR-0008 Decision 4): goalThreshold/percentComplete removed;
  // rank is deliberately NOT added here (unlike the dashboard/GET
  // /players/me teamPool blocks) — computing a system-wide rank on this
  // app's hottest write path is an avoidable cost. A client that wants an
  // updated rank after logging re-fetches one of those two instead.
  teamPool: {
    pointsTotal: number;
  };
  // NEW in Phase 2 (docs/api/phase2-contract.md, ADR-0005 Decision 3): only
  // non-null on the one log whose insertion caused the team to cross its
  // active weekly goal's target for the first (and only) time.
  goalBonus: { awardedPoints: number } | null;
  // docs/adr/0038 Consequences — the base points this log added to the
  // team pot (goal bonus excluded; that is `goalBonus`). 0 only for a
  // click-only log over the weekly cap, so the app can explain the zero
  // instead of showing it silently.
  pointsAwarded: number;
  // The allowance AFTER this log — same shape as
  // GET /training-logs/click-only-allowance.
  clickOnlyAllowance: ClickOnlyAllowance;
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
    @InjectRepository(VideoClip)
    private readonly videoClipRepository: Repository<VideoClip>,
  ) {}

  /**
   * docs/adr/0025 Decision 3 — what "video-verified" is allowed to mean.
   *
   * Three requirements, and the third is the one that stops the obvious
   * abuse: the clip must be PUBLISHED (so it passed ADR-0010 Decision 3's
   * real size/content-type and metadata-strip checks — an upload that never
   * completed proves nothing), it must belong to THIS player, and it must
   * have been created near this session. Without the window, one old clip
   * could verify every future log forever.
   *
   * Deliberately does NOT claim the video shows the activity. Confirming
   * that needs ADR-0018's tagging work, which is blocked on a model
   * decision. This is proof a real clip was made around the time claimed —
   * materially stronger than a checkbox, materially weaker than
   * verification, and the copy must not overstate it.
   */
  private async resolveEvidenceClipTier(
    playerId: string,
    dto: CreateTrainingLogDto,
  ): Promise<EvidenceTier | null> {
    if (!dto.evidenceClipId) {
      return null;
    }

    const clip = await this.videoClipRepository.findOne({
      where: {
        id: dto.evidenceClipId,
        uploaderPlayerId: playerId,
        status: VideoClipStatus.PUBLISHED,
      },
    });
    if (!clip) {
      throw new EvidenceClipNotUsableException();
    }

    const ageMs = Date.now() - clip.createdAt.getTime();
    if (ageMs > EVIDENCE_CLIP_MAX_AGE_MS) {
      throw new EvidenceClipNotUsableException();
    }

    // One clip verifies one log. Without this, a single video pays out
    // indefinitely — the exact "more ways to claim points" outcome
    // BACKLOG.md's anti-gaming note says any implementation must be checked
    // against.
    const alreadyUsed = await this.trainingLogEntryRepository.findOne({
      where: { evidenceClipId: dto.evidenceClipId },
    });
    if (alreadyUsed) {
      throw new EvidenceClipAlreadyUsedException();
    }

    return dto.sharedWithTeam
      ? EvidenceTier.VIDEO_SHARED_WITH_TEAM
      : EvidenceTier.VIDEO;
  }

  /**
   * docs/adr/0038 Decision 2 — validates and consumes a server-held timer,
   * returning the minutes it allows: `min(planned, whole minutes elapsed)`.
   *
   * Runs inside the logging transaction AFTER the player row lock. Both
   * writers of a player's timers (this and TrainingTimersService.start)
   * take that lock first, so two concurrent logs cannot both consume the
   * same timer; the partial unique index on training_log_entry.timer_id
   * backs that up at the database.
   *
   * A rejection rolls the whole transaction back, so a too-short attempt
   * leaves the timer open for the player to finish.
   */
  private async consumeTimer(
    manager: EntityManager,
    playerId: string,
    timerId: string,
    now: Date,
  ): Promise<number> {
    const repository = manager.getRepository(TrainingTimer);
    const timer = await repository.findOne({
      where: { id: timerId, playerId },
    });
    if (!timer) {
      throw new TrainingTimerNotUsableException();
    }
    if (timer.consumedAt) {
      throw new TrainingTimerAlreadyUsedException();
    }
    const elapsedMs = now.getTime() - timer.startedAt.getTime();
    if (elapsedMs > TRAINING_TIMER_MAX_AGE_MS) {
      throw new TrainingTimerNotUsableException();
    }
    const elapsedWholeMinutes = Math.floor(elapsedMs / MS_PER_MINUTE);
    if (elapsedWholeMinutes < 1) {
      throw new TrainingTimerTooShortException();
    }
    await repository.update({ id: timer.id }, { consumedAt: now });
    // Decision 3: stopping early pays the minutes actually done.
    return Math.min(timer.plannedMinutes, elapsedWholeMinutes);
  }

  /**
   * Click-only logs this player has made in the Monday–Sunday Stockholm
   * week `[weekStart, weekEnd]` — paid or not. Same `AT TIME ZONE` day
   * boundary as WeeklyGoalService.computeTeamProgress, so "this week"
   * means the same thing to the cap as it does to the weekly goal.
   */
  private async countClickOnlyLogs(
    manager: EntityManager | undefined,
    playerId: string,
    weekStart: string,
    weekEnd: string,
  ): Promise<number> {
    const repository = manager
      ? manager.getRepository(TrainingLogEntry)
      : this.trainingLogEntryRepository;
    const raw = await repository
      .createQueryBuilder('log')
      .select('COUNT(*)', 'count')
      .where('log.player_id = :playerId', { playerId })
      .andWhere('log.evidence_tier = :tier', {
        tier: EvidenceTier.CLICK_ONLY,
      })
      .andWhere(
        "(log.logged_at AT TIME ZONE 'Europe/Stockholm')::date BETWEEN :weekStart AND :weekEnd",
        { weekStart, weekEnd },
      )
      .getRawOne<{ count: string }>();
    return Number(raw?.count ?? 0);
  }

  /** `GET /api/v1/training-logs/click-only-allowance` — ADR-0038 Decision
   * 4's "the allowance is visible before the choice". Read-only and
   * unlocked: it is a preview, and the authoritative count is retaken
   * under the player lock when a log is actually written. */
  async getClickOnlyAllowance(playerId: string): Promise<ClickOnlyAllowance> {
    const { weekStart, weekEnd, nextWeekStart } = stockholmWeekBounds(
      stockholmDateString(),
    );
    const count = await this.countClickOnlyLogs(
      undefined,
      playerId,
      weekStart,
      weekEnd,
    );
    return {
      used: Math.min(count, CLICK_ONLY_WEEKLY_LIMIT),
      limit: CLICK_ONLY_WEEKLY_LIMIT,
      resetsOn: nextWeekStart,
    };
  }

  async logTraining(
    playerId: string,
    dto: CreateTrainingLogDto,
  ): Promise<TrainingLogResponse> {
    // Pre-transaction consent check (ADR-0002 addendum §2 / the contract's
    // implementer note: "before that transaction starts, not after").
    const player = await this.playersService.findByIdOrThrow(playerId);
    assertConsentApproved(player.parentalConsentStatus);
    assertTeamJoinApproved(player.teamJoinStatus);

    // Resolved before the transaction: it is a read-only validation, and a
    // rejected clip should cost the player nothing (no streak transition,
    // no pot write, no lock held while we look at storage metadata).
    const clipTier = await this.resolveEvidenceClipTier(playerId, dto);

    // One instant for the whole request, so the day the streak is credited
    // to, the week the cap counts in, the timer's elapsed minutes and the
    // stored logged_at can never disagree across a midnight.
    const now = new Date();
    const today = stockholmDateString(now);
    const { weekStart, weekEnd, nextWeekStart } = stockholmWeekBounds(today);

    const {
      trainingLog,
      streakUpdate,
      updatedPot,
      goalBonus,
      pointsAwarded,
      clickOnlyUsed,
    } = await this.dataSource.transaction(async (manager) => {
      // Row-locked re-read: guards against a consent revocation racing in
      // between the check above and this transaction, and serializes
      // concurrent same-day requests for this player so the streak
      // transition below can't be lost to a race.
      const lockedPlayer = await this.playersService.findByIdForUpdate(
        manager,
        playerId,
      );
      assertConsentApproved(lockedPlayer.parentalConsentStatus);
      assertTeamJoinApproved(lockedPlayer.teamJoinStatus);

      // ADR-0038 Decision 2: the timer fixes the minutes. Decision 5: a
      // clip, when also attached, sets the tier — multipliers are never
      // added together.
      const durationMinutes = dto.timerId
        ? Math.min(
            dto.durationMinutes,
            await this.consumeTimer(manager, playerId, dto.timerId, now),
          )
        : dto.durationMinutes;
      const evidenceTier =
        clipTier ??
        (dto.timerId ? EvidenceTier.TIMED : EvidenceTier.CLICK_ONLY);

      // ADR-0038 Decision 4: counted here, under the player row lock taken
      // above, so two concurrent taps cannot both be the 3rd. Taken
      // before this log is inserted, so it is the count of PRIOR taps.
      const priorClickOnlyLogs = await this.countClickOnlyLogs(
        manager,
        playerId,
        weekStart,
        weekEnd,
      );
      const clickOnlyUsed = Math.min(
        priorClickOnlyLogs + (evidenceTier === EvidenceTier.CLICK_ONLY ? 1 : 0),
        CLICK_ONLY_WEEKLY_LIMIT,
      );

      const streakUpdate = computeStreakUpdate(
        {
          currentStreakCount: lockedPlayer.currentStreakCount,
          longestStreakCount: lockedPlayer.longestStreakCount,
          lastTrainedDate: lockedPlayer.lastTrainedDate,
          bankedStreakSaverCount: lockedPlayer.bankedStreakSaverCount,
        },
        today,
      );

      const trainingLogRepository = manager.getRepository(TrainingLogEntry);
      const trainingLog = await trainingLogRepository.save(
        trainingLogRepository.create({
          playerId,
          teamId: lockedPlayer.teamId,
          loggedAt: now,
          activityType: dto.activityType,
          durationMinutes,
          evidenceClipId: dto.evidenceClipId ?? null,
          evidenceTier,
          timerId: dto.timerId ?? null,
          challengeId: dto.challengeId ?? null,
        }),
      );

      // Streak fields only change on the first log of a new day — a repeat
      // same-day log still contributes to the team pool below, but leaves
      // Player.current_streak_count/longest_streak_count/last_trained_date/
      // banked_streak_saver_count untouched, per the contract's
      // same-day-logging rule (docs/adr/0024-streak-savers.md Decision 5:
      // no saver is spent or earned on a same-day repeat either).
      if (!streakUpdate.alreadyLoggedToday) {
        await this.playersService.updateStreakFields(
          manager,
          playerId,
          {
            currentStreakCount: streakUpdate.currentStreakCount,
            longestStreakCount: streakUpdate.longestStreakCount,
            lastTrainedDate: streakUpdate.lastTrainedDate as string,
            bankedStreakSaverCount: streakUpdate.bankedStreakSaverCount,
          },
          {
            trainingLogEntryId: trainingLog.id,
            bankedStreakSaverCountBefore: lockedPlayer.bankedStreakSaverCount,
            coveredDates: streakSaverCoveredDates(
              today,
              streakUpdate.streakSaversSpent,
            ),
            streakSaverEarned: streakUpdate.streakSaverEarned,
          },
        );
      }

      const pot = await this.teamPoolService.getActivePotForTeam(
        lockedPlayer.teamId,
        manager,
      );
      // An over-cap tap pays 0 (ADR-0038 Decision 4) and skips the pot
      // write entirely; it still reaches the goal-bonus check below, since
      // its minutes and session still count toward the weekly goal.
      const pointsAwarded = pointsForTrainingLog(
        durationMinutes,
        evidenceTier,
        priorClickOnlyLogs,
      );
      let updatedPot =
        pointsAwarded > 0
          ? await this.teamPoolService.addPoints(manager, pot.id, pointsAwarded)
          : pot;

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

      return {
        trainingLog,
        streakUpdate,
        updatedPot,
        goalBonus,
        pointsAwarded,
        clickOnlyUsed,
      };
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
        bankedStreakSaverCount: streakUpdate.bankedStreakSaverCount,
        streakSaverSpent: streakUpdate.streakSaversSpent,
        streakSaverEarned: streakUpdate.streakSaverEarned,
      },
      teamPool: {
        pointsTotal: updatedPot.pointsTotal,
      },
      goalBonus,
      pointsAwarded,
      clickOnlyAllowance: {
        used: clickOnlyUsed,
        limit: CLICK_ONLY_WEEKLY_LIMIT,
        resetsOn: nextWeekStart,
      },
    };
  }
}
