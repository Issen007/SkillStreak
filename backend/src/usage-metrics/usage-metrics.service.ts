import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { stockholmDateString } from '../common/time/stockholm-date.util';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { TeamJoinStatus } from '../players/team-join-status.enum';
import { TeamPoolService } from '../team-pool/team-pool.service';
import {
  DEFAULT_USAGE_REPORT_MIN_TEAMS_PER_BUCKET,
  MINIMUM_USAGE_REPORT_MIN_TEAMS_PER_BUCKET,
  USAGE_METRICS_WINDOW_DAYS,
} from './usage-metrics.constants';
import {
  TeamGoalOutcomeRow,
  TeamStatusCountRow,
  UsageMetricsQueryService,
} from './usage-metrics.query.service';
import {
  AdoptionFunnelBucketFigures,
  AdoptionFunnelFigures,
  TeamSizeBucket,
  TeamSizeBucketFigures,
  TeamSizeBucketedMetric,
  UsageMetricsReport,
  WeeklyGoalBucketFigures,
  WeeklyGoalEngagementFigures,
} from './usage-metrics.types';
import {
  applyMinimumPopulationFloor,
  buildStreakHistogram,
  computeTeamPoolGrowth,
  fillWeeklySeries,
  meanOf,
  percentOf,
} from './usage-metrics.util';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * docs/adr/0020-usage-analytics-product-metrics.md Decision 1 — computes
 * the fixed, allow-listed metric set, once, over a trailing window as of
 * `now`. Nothing is persisted (Decision 6: no history table, the emailed
 * reports are the de facto record) and nothing here is reachable from any
 * HTTP endpoint — the only caller is UsageMetricsReportService's scheduled
 * job (Decision 5: no new endpoint, no new admin-auth system).
 *
 * The division of labour in this module:
 *
 * - UsageMetricsQueryService — all SQL, all already-aggregated (Decision 2).
 * - usage-metrics.util.ts — the pure bucketing/histogram/floor logic.
 * - this class — assembles a report from those two, and owns the one piece
 *   of policy that needs both halves: which team-size breakdowns are
 *   allowed to be printed at all (Decision 3's floor).
 *
 * Decision 3's granularity rules, enforced here rather than left to the
 * email template: exactly two metrics (adoption/consent funnel, weekly-goal
 * engagement) get a team-size breakdown, both via
 * TeamPoolService.bucketEligiblePlayerCount — ADR-0016's addendum bucketing,
 * imported rather than re-derived, so the `'1-2'`/`'3-5'`/`'6+'` boundaries
 * can never drift apart between the two features that use them.
 */
@Injectable()
export class UsageMetricsService {
  private readonly logger = new Logger(UsageMetricsService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly queryService: UsageMetricsQueryService,
  ) {}

  async collect(now: Date = new Date()): Promise<UsageMetricsReport> {
    const windowStart = new Date(
      now.getTime() - USAGE_METRICS_WINDOW_DAYS * MS_PER_DAY,
    );
    const sevenDayCutoff = new Date(now.getTime() - 7 * MS_PER_DAY);
    const minTeamsPerBucket = this.minTeamsPerBucket();

    // Sequential, not Promise.all: this is a monthly background job with no
    // latency budget at all, and running eight aggregate queries one at a
    // time keeps it from competing with real player traffic for connections
    // in the API's own shared pool (Decision 5 deliberately reuses that pool
    // rather than opening a second one).
    const funnelRows = await this.queryService.queryAdoptionFunnelRows();
    const currentStreakRows =
      await this.queryService.queryCurrentStreakValueCounts();
    const longestStreakRows =
      await this.queryService.queryLongestStreakValueCounts();
    const recency = await this.queryService.queryActivityRecency(
      sevenDayCutoff,
      windowStart,
    );
    const trainingTypeRows =
      await this.queryService.queryTrainingTypeMix(windowStart);
    const goalRows = await this.queryService.queryWeeklyGoalOutcomeRows(
      stockholmDateString(windowStart),
      stockholmDateString(now),
    );
    const potRows = await this.queryService.queryActivePotGrowthRows();
    const clipRows =
      await this.queryService.queryClipUploadsPerWeek(windowStart);
    const chatRows =
      await this.queryService.queryChatMessagesPerWeek(windowStart);
    const badgeRows = await this.queryService.queryBadgeMix(windowStart);

    const bucketByTeamId = this.bucketTeamsByEligiblePlayerCount(funnelRows);
    const totalLogCount = trainingTypeRows.reduce(
      (sum, row) => sum + row.logCount,
      0,
    );

    return {
      generatedAt: now,
      windowStart,
      windowDays: USAGE_METRICS_WINDOW_DAYS,
      minTeamsPerBucket,
      totalTeams: bucketByTeamId.size,

      adoptionFunnel: this.buildAdoptionFunnel(
        funnelRows,
        bucketByTeamId,
        minTeamsPerBucket,
      ),

      streakHealth: {
        totalPlayers: currentStreakRows.reduce(
          (sum, row) => sum + row.playerCount,
          0,
        ),
        currentStreakHistogram: buildStreakHistogram(currentStreakRows),
        longestStreakHistogram: buildStreakHistogram(longestStreakRows),
      },

      activityRecency: {
        totalPlayers: recency.totalPlayers,
        playersActiveLast7Days: recency.playersActiveLast7Days,
        percentActiveLast7Days: percentOf(
          recency.playersActiveLast7Days,
          recency.totalPlayers,
        ),
        playersActiveInWindow: recency.playersActiveInWindow,
        percentActiveInWindow: percentOf(
          recency.playersActiveInWindow,
          recency.totalPlayers,
        ),
      },

      trainingTypeMix: trainingTypeRows
        .map((row) => ({
          activityType: row.activityType,
          logCount: row.logCount,
          percentOfLogs: percentOf(row.logCount, totalLogCount),
        }))
        .sort((a, b) => b.logCount - a.logCount),

      weeklyGoalEngagement: this.buildWeeklyGoalEngagement(
        goalRows,
        bucketByTeamId,
        minTeamsPerBucket,
      ),

      teamPoolGrowth: computeTeamPoolGrowth(potRows, now),

      socialUsage: {
        clipUploadsPerWeek: fillWeeklySeries(clipRows, windowStart, now),
        chatMessagesPerWeek: fillWeeklySeries(chatRows, windowStart, now),
      },

      badgeMix: [...badgeRows]
        .sort((a, b) => b.awardCount - a.awardCount)
        .map((row) => ({
          badgeId: row.badgeId,
          badgeKey: row.badgeKey,
          awardCount: row.awardCount,
        })),
    };
  }

  /**
   * Decision 3's floor, as a config value ("tunable, not an architectural
   * constant" — the security review's own words). Clamped at
   * MINIMUM_USAGE_REPORT_MIN_TEAMS_PER_BUCKET rather than trusted blindly:
   * a floor of 1 would re-open exactly the single-team-bucket hole this
   * setting exists to close, so a mis-set value degrades to the safe end,
   * loudly, instead of silently disabling the protection.
   */
  private minTeamsPerBucket(): number {
    const raw = this.configService
      .get<string>('USAGE_REPORT_MIN_TEAMS_PER_BUCKET')
      ?.trim();
    if (!raw) return DEFAULT_USAGE_REPORT_MIN_TEAMS_PER_BUCKET;

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      this.logger.warn(
        `USAGE_REPORT_MIN_TEAMS_PER_BUCKET="${raw}" is not a positive integer — falling back to ${DEFAULT_USAGE_REPORT_MIN_TEAMS_PER_BUCKET}.`,
      );
      return DEFAULT_USAGE_REPORT_MIN_TEAMS_PER_BUCKET;
    }

    const effective = Math.max(
      parsed,
      MINIMUM_USAGE_REPORT_MIN_TEAMS_PER_BUCKET,
    );
    // security-reviewer's hardening ask: the hard clamp alone made 2/3/4
    // silently acceptable even though the reviewed, signed-off floor is
    // N >= 5. Anything below the ADR's recommendation is now said out loud
    // every run, so weakening the protection can't happen unnoticed — the
    // clamp still refuses the genuinely degenerate values outright.
    if (effective < DEFAULT_USAGE_REPORT_MIN_TEAMS_PER_BUCKET) {
      this.logger.warn(
        `USAGE_REPORT_MIN_TEAMS_PER_BUCKET=${parsed} is below ADR-0020 Decision 3's reviewed floor of ${DEFAULT_USAGE_REPORT_MIN_TEAMS_PER_BUCKET} teams — reporting a bucket this small is weaker than what the security review signed off on. Using ${effective}.`,
      );
    }
    return effective;
  }

  /**
   * Every team that has at least one Player row, mapped to its ADR-0016
   * size bucket. Teams with zero *eligible* players (everyone still
   * consent-pending, say) deliberately land in `'1-2'` rather than being
   * dropped: the buckets have to partition the teams for
   * applyMinimumPopulationFloor's residual arithmetic to hold, and a team
   * with no eligible players is, if anything, the most fragile case for
   * this floor to protect — not one to quietly exclude.
   */
  private bucketTeamsByEligiblePlayerCount(
    rows: TeamStatusCountRow[],
  ): Map<string, TeamSizeBucket> {
    const eligibleCountByTeamId = new Map<string, number>();
    for (const row of rows) {
      const current = eligibleCountByTeamId.get(row.teamId) ?? 0;
      const isEligible =
        row.parentalConsentStatus === ParentalConsentStatus.APPROVED &&
        row.teamJoinStatus === TeamJoinStatus.APPROVED;
      eligibleCountByTeamId.set(
        row.teamId,
        current + (isEligible ? row.playerCount : 0),
      );
    }

    return new Map(
      [...eligibleCountByTeamId].map(([teamId, eligibleCount]) => [
        teamId,
        TeamPoolService.bucketEligiblePlayerCount(eligibleCount),
      ]),
    );
  }

  private buildAdoptionFunnel(
    rows: TeamStatusCountRow[],
    bucketByTeamId: Map<string, TeamSizeBucket>,
    minTeamsPerBucket: number,
  ): TeamSizeBucketedMetric<
    AdoptionFunnelFigures,
    AdoptionFunnelBucketFigures
  > {
    const appWide = this.aggregateFunnel(rows);

    const teamIdsByBucket = new Map<TeamSizeBucket, Set<string>>();
    for (const [teamId, bucket] of bucketByTeamId) {
      const teamIds = teamIdsByBucket.get(bucket) ?? new Set<string>();
      teamIds.add(teamId);
      teamIdsByBucket.set(bucket, teamIds);
    }

    // Per-team figures first, then a mean over teams — never a pooled sum
    // across the bucket. See TeamSizeBucketedMetric's docstring: the buckets
    // are keyed on a team's *eligible* player count, so a 40-member team
    // whose players are all still consent-pending sits in `'1-2'`, and a
    // pooled figure there would be that one team's number wearing a
    // five-team bucket's clothes.
    const perTeam = this.aggregateFunnelPerTeam(rows);

    const buckets: TeamSizeBucketFigures<AdoptionFunnelBucketFigures>[] = [
      ...teamIdsByBucket,
    ].map(([bucket, teamIds]) => {
      const teams = [...teamIds].map(
        (teamId) =>
          perTeam.get(teamId) ?? {
            totalPlayers: 0,
            percentConsentApproved: 0,
            percentWithTrainingLog: 0,
          },
      );
      return {
        bucket,
        teamCount: teamIds.size,
        figures: {
          meanPlayersPerTeam: meanOf(teams.map((team) => team.totalPlayers)),
          meanPercentConsentApproved: meanOf(
            teams.map((team) => team.percentConsentApproved),
          ),
          meanPercentWithTrainingLog: meanOf(
            teams.map((team) => team.percentWithTrainingLog),
          ),
        },
      };
    });

    return this.applyFloor(appWide, buckets, minTeamsPerBucket);
  }

  /** One row per team: the two rates the bucketed funnel averages, plus the
   * roster size. Never leaves this class keyed by team — see
   * buildAdoptionFunnel. */
  private aggregateFunnelPerTeam(rows: TeamStatusCountRow[]): Map<
    string,
    {
      totalPlayers: number;
      percentConsentApproved: number;
      percentWithTrainingLog: number;
    }
  > {
    const rowsByTeamId = new Map<string, TeamStatusCountRow[]>();
    for (const row of rows) {
      rowsByTeamId.set(row.teamId, [
        ...(rowsByTeamId.get(row.teamId) ?? []),
        row,
      ]);
    }

    return new Map(
      [...rowsByTeamId].map(([teamId, teamRows]) => {
        const figures = this.aggregateFunnel(teamRows);
        return [
          teamId,
          {
            totalPlayers: figures.totalPlayers,
            percentConsentApproved: percentOf(
              figures.playersByParentalConsentStatus[
                ParentalConsentStatus.APPROVED
              ],
              figures.totalPlayers,
            ),
            percentWithTrainingLog: figures.percentWithAtLeastOneTrainingLog,
          },
        ];
      }),
    );
  }

  /**
   * The one place the floor is applied, so both bucketed metrics get
   * identical treatment — including `foldedIntoAppWide`, which the report's
   * own note is driven off. It's true whenever ANY non-empty bucket was
   * withheld, not only when the whole breakdown was: partial suppression is
   * the common case at this app's scale, and silently printing one bucket
   * of three with no explanation is exactly how a reader ends up believing
   * the other two had no teams in them.
   */
  private applyFloor<TAppWide, TBucket>(
    appWide: TAppWide,
    buckets: TeamSizeBucketFigures<TBucket>[],
    minTeamsPerBucket: number,
  ): TeamSizeBucketedMetric<TAppWide, TBucket> {
    const nonEmpty = buckets.filter((entry) => entry.teamCount > 0);
    const reported = applyMinimumPopulationFloor(nonEmpty, minTeamsPerBucket);
    return {
      appWide,
      byTeamSizeBucket: reported,
      foldedIntoAppWide: reported.length < nonEmpty.length,
    };
  }

  private aggregateFunnel(rows: TeamStatusCountRow[]): AdoptionFunnelFigures {
    const playersByParentalConsentStatus = Object.fromEntries(
      Object.values(ParentalConsentStatus).map((status) => [status, 0]),
    ) as Record<ParentalConsentStatus, number>;
    const playersByTeamJoinStatus = Object.fromEntries(
      Object.values(TeamJoinStatus).map((status) => [status, 0]),
    ) as Record<TeamJoinStatus, number>;

    let totalPlayers = 0;
    let playersWithAtLeastOneTrainingLog = 0;
    for (const row of rows) {
      totalPlayers += row.playerCount;
      playersWithAtLeastOneTrainingLog += row.playersWithAtLeastOneTrainingLog;
      playersByParentalConsentStatus[row.parentalConsentStatus] +=
        row.playerCount;
      playersByTeamJoinStatus[row.teamJoinStatus] += row.playerCount;
    }

    return {
      totalPlayers,
      playersByParentalConsentStatus,
      playersByTeamJoinStatus,
      playersWithAtLeastOneTrainingLog,
      percentWithAtLeastOneTrainingLog: percentOf(
        playersWithAtLeastOneTrainingLog,
        totalPlayers,
      ),
    };
  }

  private buildWeeklyGoalEngagement(
    rows: TeamGoalOutcomeRow[],
    bucketByTeamId: Map<string, TeamSizeBucket>,
    minTeamsPerBucket: number,
  ): TeamSizeBucketedMetric<
    WeeklyGoalEngagementFigures,
    WeeklyGoalBucketFigures
  > {
    const appWide = this.aggregateGoalOutcomes(rows);

    const rowsByBucket = new Map<TeamSizeBucket, TeamGoalOutcomeRow[]>();
    for (const row of rows) {
      // A team with a concluded goal but no Player rows at all (every
      // member erased since, per ADR-0013) isn't in the map — treated as
      // the smallest bucket, which is the conservative direction: it can
      // only make a bucket more likely to be suppressed, never less.
      const bucket = bucketByTeamId.get(row.teamId) ?? '1-2';
      rowsByBucket.set(bucket, [...(rowsByBucket.get(bucket) ?? []), row]);
    }

    const buckets: TeamSizeBucketFigures<WeeklyGoalBucketFigures>[] = [
      ...rowsByBucket,
    ].map(([bucket, bucketRows]) => ({
      bucket,
      // The population this floor protects is "teams whose goals are in
      // this bucket's percentage", not "teams that exist" — a bucket with
      // four teams' goals in it is a four-team aggregate no matter how many
      // other same-sized teams ran no goal at all this period.
      teamCount: new Set(bucketRows.map((row) => row.teamId)).size,
      // Mean of each team's OWN completion rate, not sum/sum: a captain who
      // ran eight goals while four other teams ran one each would otherwise
      // be two thirds of a five-team bucket — and a `'1-2'` team is at most
      // two children, so the floor would be binding on team count while the
      // number moved with something else entirely (code-critic finding).
      figures: {
        meanTeamCompletionPercent: meanOf(
          this.perTeamCompletionPercents(bucketRows),
        ),
      },
    }));

    return this.applyFloor(appWide, buckets, minTeamsPerBucket);
  }

  /** One completion percentage per team that ran at least one concluded
   * goal. A team whose goals were all cancelled contributes nothing (it has
   * no rate), rather than contributing a 0% it didn't earn. */
  private perTeamCompletionPercents(rows: TeamGoalOutcomeRow[]): number[] {
    const byTeamId = new Map<
      string,
      { concluded: number; completed: number }
    >();
    for (const row of rows) {
      const current = byTeamId.get(row.teamId) ?? {
        concluded: 0,
        completed: 0,
      };
      byTeamId.set(row.teamId, {
        concluded: current.concluded + row.concludedGoalCount,
        completed: current.completed + row.completedGoalCount,
      });
    }
    return [...byTeamId.values()]
      .filter((team) => team.concluded > 0)
      .map((team) => percentOf(team.completed, team.concluded));
  }

  private aggregateGoalOutcomes(
    rows: TeamGoalOutcomeRow[],
  ): WeeklyGoalEngagementFigures {
    const sum = (pick: (row: TeamGoalOutcomeRow) => number): number =>
      rows.reduce((total, row) => total + pick(row), 0);

    const concludedGoalCount = sum((row) => row.concludedGoalCount);
    const completedGoalCount = sum((row) => row.completedGoalCount);
    return {
      concludedGoalCount,
      completedGoalCount,
      percentCompleted: percentOf(completedGoalCount, concludedGoalCount),
      cancelledGoalCount: sum((row) => row.cancelledGoalCount),
    };
  }
}
