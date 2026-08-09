import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { Badge } from '../badges/entities/badge.entity';
import { BadgeAward } from '../badges/entities/badge-award.entity';
import {
  Challenge,
  ChallengeStatus,
} from '../challenges/entities/challenge.entity';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { TeamJoinStatus } from '../players/team-join-status.enum';
import { Player } from '../players/entities/player.entity';
import { Season } from '../team-pool/entities/season.entity';
import { TeamSeasonPot } from '../team-pool/entities/team-season-pot.entity';
import { TeamSeasonPotStatus } from '../team-pool/team-season-pot-status.enum';
import { TeamChatMessage } from '../team-chat/entities/team-chat-message.entity';
import { ActivityType } from '../training-logs/activity-type.enum';
import { TrainingLogEntry } from '../training-logs/entities/training-log-entry.entity';
import { VideoClip } from '../video-clips/entities/video-clip.entity';

/**
 * docs/adr/0020-usage-analytics-product-metrics.md Decision 2 — the ONLY
 * place in this module that touches a database, and it touches exactly one:
 * Postgres, through the API's own existing TypeORM connection. Redis is
 * never a source here (Decision 2 says so explicitly: it's a flushable
 * cache with no historical/audit guarantee, so a metrics report must not
 * read it), and this class holds no repository for, and never joins to,
 * `PlayerPrivateInfo` — the table ADR-0002's addendum §1 isolates
 * `real_name`/`parent_contact` into.
 *
 * Every method below returns **already-aggregated rows** (counts grouped by
 * a status/enum/bucket key), never a row per child. Two queries do select a
 * `team_id`, purely as the grouping key Decision 3's team-size
 * stratification needs — the same count-only, name-free shape ADR-0016
 * Decision 4's own cross-team query established. `team.name` is never
 * selected anywhere in this file, and those team ids are consumed inside
 * UsageMetricsService (to assign a team to a size bucket) and never reach
 * the report, per Decision 3's "never a named-team row".
 *
 * Explicitly never selected anywhere here: `TeamChatMessage.content`,
 * `VideoClip.caption`/`storage_key`, `Player.screen_name`, any player id,
 * or any other freeform field. Decision 1's allow-list is enforced by what
 * this file's SQL asks for, not only by what the report happens to print.
 */
@Injectable()
export class UsageMetricsQueryService {
  constructor(
    @InjectRepository(Player)
    private readonly playerRepository: Repository<Player>,
    @InjectRepository(TrainingLogEntry)
    private readonly trainingLogRepository: Repository<TrainingLogEntry>,
    @InjectRepository(Challenge)
    private readonly challengeRepository: Repository<Challenge>,
    @InjectRepository(TeamSeasonPot)
    private readonly teamSeasonPotRepository: Repository<TeamSeasonPot>,
    @InjectRepository(VideoClip)
    private readonly videoClipRepository: Repository<VideoClip>,
    @InjectRepository(TeamChatMessage)
    private readonly teamChatMessageRepository: Repository<TeamChatMessage>,
    @InjectRepository(BadgeAward)
    private readonly badgeAwardRepository: Repository<BadgeAward>,
  ) {}

  /**
   * Metric 1's single source query (adoption/consent funnel). One row per
   * (team, consent status, join status) combination — enough to derive both
   * the app-wide funnel and, by re-grouping in application code, every
   * team-size bucket's own funnel, without a second query and without ever
   * reading a per-player row.
   *
   * `playersWithAtLeastOneTrainingLog` is a lifetime "has this child ever
   * logged anything" flag, deliberately NOT window-scoped: it's the last
   * step of an onboarding funnel ("signed up -> consented -> joined ->
   * actually trained once"), while the trailing-window "are they still
   * training" question is Metric 3's job (queryActivityRecency below).
   */
  async queryAdoptionFunnelRows(): Promise<TeamStatusCountRow[]> {
    const rows = await this.playerRepository
      .createQueryBuilder('player')
      .select('player.team_id', 'teamId')
      .addSelect('player.parental_consent_status', 'parentalConsentStatus')
      .addSelect('player.team_join_status', 'teamJoinStatus')
      .addSelect('COUNT(*)', 'playerCount')
      .addSelect(
        'COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM training_log_entry log WHERE log.player_id = player.id))',
        'playersWithAtLeastOneTrainingLog',
      )
      .groupBy('player.team_id')
      .addGroupBy('player.parental_consent_status')
      .addGroupBy('player.team_join_status')
      .getRawMany<{
        teamId: string;
        parentalConsentStatus: ParentalConsentStatus;
        teamJoinStatus: TeamJoinStatus;
        playerCount: string;
        playersWithAtLeastOneTrainingLog: string;
      }>();

    return rows.map((row) => ({
      teamId: row.teamId,
      parentalConsentStatus: row.parentalConsentStatus,
      teamJoinStatus: row.teamJoinStatus,
      playerCount: Number(row.playerCount),
      playersWithAtLeastOneTrainingLog: Number(
        row.playersWithAtLeastOneTrainingLog,
      ),
    }));
  }

  /**
   * Metric 2 — counts grouped by the streak value itself, not the values
   * themselves: the DB returns "17 players have a current streak of 0, 3
   * have 4, ...", and the bucketing into Decision 1's fixed
   * `0`/`1-3`/`4-7`/`8-14`/`15-30`/`31+` bars happens in
   * usage-metrics.util.ts. That split is deliberate — it keeps the ADR's
   * bucket boundaries in one testable place (they're a stated part of the
   * allow-list, not an SQL detail) while still never pulling a per-player
   * row out of Postgres, so "never a sorted list of individual values"
   * holds at both layers.
   */
  async queryCurrentStreakValueCounts(): Promise<StreakValueCountRow[]> {
    return this.queryStreakValueCounts('current_streak_count');
  }

  async queryLongestStreakValueCounts(): Promise<StreakValueCountRow[]> {
    return this.queryStreakValueCounts('longest_streak_count');
  }

  private async queryStreakValueCounts(
    column: 'current_streak_count' | 'longest_streak_count',
  ): Promise<StreakValueCountRow[]> {
    // The union type on `column` is what makes this interpolation safe —
    // there is no caller-supplied string anywhere in this expression.
    const rows = await this.playerRepository
      .createQueryBuilder('player')
      .select(`player.${column}`, 'streakCount')
      .addSelect('COUNT(*)', 'playerCount')
      .groupBy(`player.${column}`)
      .getRawMany<{ streakCount: number | string; playerCount: string }>();

    return rows.map((row) => ({
      streakCount: Number(row.streakCount),
      playerCount: Number(row.playerCount),
    }));
  }

  /**
   * Metric 3 — one row, three numbers. Both cutoffs are passed in (rather
   * than computed here) so the whole report is consistent with a single
   * `now`, and so this stays a pure function of its inputs for the caller's
   * tests. The second cutoff is the report window itself, not a hardcoded
   * 30 days — the ADR's "trailing 7/30 days" and Decision 6's 30-day window
   * are the same number today, and this keeps them the same number if
   * USAGE_METRICS_WINDOW_DAYS ever changes, rather than silently
   * mislabelling one of them.
   */
  async queryActivityRecency(
    sevenDayCutoff: Date,
    windowStart: Date,
  ): Promise<ActivityRecencyRow> {
    const row = await this.playerRepository
      .createQueryBuilder('player')
      .select('COUNT(*)', 'totalPlayers')
      .addSelect(
        'COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM training_log_entry log WHERE log.player_id = player.id AND log.logged_at >= :sevenDayCutoff))',
        'playersActiveLast7Days',
      )
      .addSelect(
        'COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM training_log_entry log WHERE log.player_id = player.id AND log.logged_at >= :windowStart))',
        'playersActiveInWindow',
      )
      .setParameters({ sevenDayCutoff, windowStart })
      .getRawOne<{
        totalPlayers: string;
        playersActiveLast7Days: string;
        playersActiveInWindow: string;
      }>();

    return {
      totalPlayers: Number(row?.totalPlayers ?? 0),
      playersActiveLast7Days: Number(row?.playersActiveLast7Days ?? 0),
      playersActiveInWindow: Number(row?.playersActiveInWindow ?? 0),
    };
  }

  /**
   * Metric 4 — a GROUP BY over `activity_type`, which is a fixed Postgres
   * enum (ActivityType), so this is an allow-listed vocabulary by
   * construction rather than new classification work (Decision 1's own
   * framing). Window-scoped: "what did teams actually train this period".
   */
  async queryTrainingTypeMix(
    windowStart: Date,
  ): Promise<ActivityTypeCountRow[]> {
    const rows = await this.trainingLogRepository
      .createQueryBuilder('log')
      .select('log.activity_type', 'activityType')
      .addSelect('COUNT(*)', 'logCount')
      .where('log.logged_at >= :windowStart', { windowStart })
      .groupBy('log.activity_type')
      .getRawMany<{ activityType: ActivityType; logCount: string }>();

    return rows.map((row) => ({
      activityType: row.activityType,
      logCount: Number(row.logCount),
    }));
  }

  /**
   * Metric 5 — weekly goals (this app's `Challenge` entity, per ADR-0005
   * Decision 2's deliberate name mismatch) whose own window ended before
   * today, and how many of those were actually met.
   *
   * **"Met" is `goal_bonus_awarded_at IS NOT NULL`, not
   * `status = 'completed'`** — a correctness fix from code-critic's review,
   * verified against the live dev database (0 of 103 challenge rows are
   * `completed`; 22 have a bonus timestamp), and the reading ADR-0020
   * Decision 1 actually asks for: "reusing ADR-0015's existing
   * per-player-completion definition rather than a new one".
   * `goal_bonus_awarded_at` IS that definition, written exactly once by
   * WeeklyGoalService.processGoalBonusForLog the moment
   * `buildPlayerGoalProgress(...).goalMet` first turns true (every eligible
   * roster member individually reached the target). `status = 'completed'`
   * is something else entirely: a captain's explicit
   * `PATCH .../weekly-goal` (the only writer, gated by
   * isLegalWeeklyGoalTransition's `active -> completed` edge). Nothing
   * anywhere auto-transitions a goal to `completed` when it's met or when
   * its end date passes, so the old query would have reported ~0% forever
   * while the feature worked fine.
   *
   * Denominator, same review: `draft` goals never started and `cancelled`
   * ones were abandoned by their captain, so neither is a goal that got a
   * fair chance to be met — both are excluded from the rate. Cancelled
   * goals are still counted and reported separately rather than dropped
   * silently, so the rate can't be quietly inflated by a captain
   * cancelling every goal that isn't going well.
   *
   * `end_date < today` (exclusive), not `<= today`: on the default 06:00
   * schedule a goal ending "today" still has ~18 hours left to be met, and
   * counting it as a failed attempt would understate every report.
   *
   * Grouped by team so the caller can stratify by team size (Decision 3) —
   * the team id never leaves that stratification step.
   */
  async queryWeeklyGoalOutcomeRows(
    windowStartDate: string,
    todayDate: string,
  ): Promise<TeamGoalOutcomeRow[]> {
    const rows = await this.challengeRepository
      .createQueryBuilder('challenge')
      .select('challenge.team_id', 'teamId')
      .addSelect(
        'COUNT(*) FILTER (WHERE challenge.status IN (:...ranStatuses))',
        'concludedGoalCount',
      )
      .addSelect(
        'COUNT(*) FILTER (WHERE challenge.status IN (:...ranStatuses) AND challenge.goal_bonus_awarded_at IS NOT NULL)',
        'completedGoalCount',
      )
      .addSelect(
        'COUNT(*) FILTER (WHERE challenge.status = :cancelled)',
        'cancelledGoalCount',
      )
      .where('challenge.end_date >= :windowStartDate', { windowStartDate })
      .andWhere('challenge.end_date < :todayDate', { todayDate })
      .setParameters({
        // 'active' belongs here, not just 'completed': a goal whose end
        // date has passed is normally still `active` in this schema —
        // there is no sweep that retires it — so excluding it would empty
        // the denominator entirely.
        ranStatuses: [ChallengeStatus.ACTIVE, ChallengeStatus.COMPLETED],
        cancelled: ChallengeStatus.CANCELLED,
      })
      .groupBy('challenge.team_id')
      .getRawMany<{
        teamId: string;
        concludedGoalCount: string;
        completedGoalCount: string;
        cancelledGoalCount: string;
      }>();

    return rows.map((row) => ({
      teamId: row.teamId,
      concludedGoalCount: Number(row.concludedGoalCount),
      completedGoalCount: Number(row.completedGoalCount),
      cancelledGoalCount: Number(row.cancelledGoalCount),
    }));
  }

  /**
   * Metric 6 — every active VM-Guld pot's accumulated total plus its
   * season's start date, which is all the growth rate (points/week) needs.
   * Deliberately selects NO team id at all: unlike Metrics 1 and 5, nothing
   * about this metric is stratified by team size, so there is no reason for
   * a team identifier to be in this result set even transiently.
   *
   * There is no history table for `points_total` (Decision 6 chose not to
   * add one), so "growth rate" here is the pot's lifetime average —
   * `points_total / weeks since the season started` — not a
   * window-restricted delta. Stated plainly in the report itself so it
   * isn't read as "points earned this month".
   */
  async queryActivePotGrowthRows(): Promise<ActivePotGrowthRow[]> {
    const rows = await this.teamSeasonPotRepository
      .createQueryBuilder('pot')
      .innerJoin(Season, 'season', 'season.id = pot.season_id')
      .select('pot.points_total', 'pointsTotal')
      // Formatted in Postgres, not parsed in JS: node-postgres turns a
      // `date` column into a Date at LOCAL midnight, so reading the calendar
      // day back out of it via toISOString() lands on the previous day in
      // any positive-offset timezone (Europe/Stockholm, i.e. every
      // environment this app runs in). Caught by this module's e2e spec —
      // it would have shifted every season start one day earlier and
      // quietly inflated the points/week rate.
      .addSelect(`to_char(season.start_date, 'YYYY-MM-DD')`, 'seasonStartDate')
      .where('pot.status = :status', { status: TeamSeasonPotStatus.ACTIVE })
      .getRawMany<{ pointsTotal: string; seasonStartDate: string }>();

    return rows.map((row) => ({
      pointsTotal: Number(row.pointsTotal),
      seasonStartDate: row.seasonStartDate,
    }));
  }

  /**
   * Metric 7a — clip UPLOAD counts per week. Counts rows by `created_at`
   * regardless of `status`: an upload is an upload even if it was later
   * hidden. Two honest caveats, noted here rather than silently baked in:
   * abandoned `pending_upload` rows are swept hourly (ADR-0010 Decision 5)
   * so they're mostly invisible to this count, and clips older than
   * CLIP_RETENTION_DAYS are gone entirely — harmless for a 30-day window
   * against a 90-day retention, but it would quietly under-count if the
   * window ever grew past retention.
   *
   * Never selects `caption`, `storage_key`, `uploader_player_id`, or
   * `tagged_player_id` — Decision 1's "counts only, never which clip, never
   * by whom".
   */
  async queryClipUploadsPerWeek(windowStart: Date): Promise<WeeklyCountRow[]> {
    return this.queryWeeklyCounts(
      this.videoClipRepository.createQueryBuilder('clip'),
      'clip',
      windowStart,
    );
  }

  /**
   * Metric 7b — chat message VOLUME per week. `content` is never selected,
   * never grouped on, and never joined to anything: Decision 1 is explicit
   * that this app has never persisted chat content for analytics and this
   * ADR does not start. Counts every row including `hidden` ones and system
   * messages (ADR-0021) — the metric is "how much chat traffic is there",
   * not "how much of it survived moderation".
   */
  async queryChatMessagesPerWeek(windowStart: Date): Promise<WeeklyCountRow[]> {
    return this.queryWeeklyCounts(
      this.teamChatMessageRepository.createQueryBuilder('message'),
      'message',
      windowStart,
    );
  }

  private async queryWeeklyCounts<T extends ObjectLiteral>(
    queryBuilder: SelectQueryBuilder<T>,
    alias: string,
    windowStart: Date,
  ): Promise<WeeklyCountRow[]> {
    // date_trunc('week', ...) is Postgres's ISO week (Monday-start), in the
    // server's timezone — the same "the server's clock decides what day it
    // is" posture common/time/stockholm-date.util.ts already establishes for
    // streaks, and precise enough for a volume-per-week trend line.
    const rows = await queryBuilder
      .select(
        `to_char(date_trunc('week', ${alias}.created_at), 'YYYY-MM-DD')`,
        'weekStart',
      )
      .addSelect('COUNT(*)', 'count')
      .where(`${alias}.created_at >= :windowStart`, { windowStart })
      .groupBy(`date_trunc('week', ${alias}.created_at)`)
      .orderBy(`date_trunc('week', ${alias}.created_at)`, 'ASC')
      .getRawMany<{ weekStart: string; count: string }>();

    return rows.map((row) => ({
      weekStart: row.weekStart,
      count: Number(row.count),
    }));
  }

  /**
   * Metric 8 — awards grouped by `badge_id`, with the fixed `badge` catalog
   * joined for its human-readable `key` only. The catalog is seeded, static
   * app content (see src/scripts/seed.ts), not user-generated text and not
   * child data, so joining it doesn't widen what this report is reading
   * about anyone — it just stops the report from being a list of uuids.
   * `BadgeAward.context` (jsonb, may carry a human-authored note per
   * ADR-0002's addendum §3) is never read.
   */
  async queryBadgeMix(windowStart: Date): Promise<BadgeAwardCountRow[]> {
    const rows = await this.badgeAwardRepository
      .createQueryBuilder('award')
      .leftJoin(Badge, 'badge', 'badge.id = award.badge_id')
      .select('award.badge_id', 'badgeId')
      .addSelect('badge.key', 'badgeKey')
      .addSelect('COUNT(*)', 'awardCount')
      .where('award.awarded_at >= :windowStart', { windowStart })
      .groupBy('award.badge_id')
      .addGroupBy('badge.key')
      .getRawMany<{
        badgeId: string;
        badgeKey: string | null;
        awardCount: string;
      }>();

    return rows.map((row) => ({
      badgeId: row.badgeId,
      badgeKey: row.badgeKey,
      awardCount: Number(row.awardCount),
    }));
  }
}

// --- Raw row shapes ----------------------------------------------------------
// Intentionally narrow: each one is "the smallest aggregate the matching
// metric can be computed from", so the aggregation logic itself (and
// Decision 3's floor) lives in plain, directly-testable TypeScript rather
// than in SQL nobody can unit-test.

export interface TeamStatusCountRow {
  teamId: string;
  parentalConsentStatus: ParentalConsentStatus;
  teamJoinStatus: TeamJoinStatus;
  playerCount: number;
  playersWithAtLeastOneTrainingLog: number;
}

export interface StreakValueCountRow {
  streakCount: number;
  playerCount: number;
}

export interface ActivityRecencyRow {
  totalPlayers: number;
  playersActiveLast7Days: number;
  playersActiveInWindow: number;
}

export interface ActivityTypeCountRow {
  activityType: ActivityType;
  logCount: number;
}

export interface TeamGoalOutcomeRow {
  teamId: string;
  /** Goals that ran to the end of their own window without being
   * cancelled — the denominator of the completion rate. */
  concludedGoalCount: number;
  /** Of those, the ones ADR-0015's per-player definition counts as met
   * (`goal_bonus_awarded_at IS NOT NULL`). */
  completedGoalCount: number;
  /** Reported alongside, never inside, the rate — see the query's comment. */
  cancelledGoalCount: number;
}

export interface ActivePotGrowthRow {
  pointsTotal: number;
  /** 'YYYY-MM-DD' — Season.start_date is a plain `date` column. */
  seasonStartDate: string;
}

export interface WeeklyCountRow {
  weekStart: string;
  count: number;
}

export interface BadgeAwardCountRow {
  badgeId: string;
  badgeKey: string | null;
  awardCount: number;
}
