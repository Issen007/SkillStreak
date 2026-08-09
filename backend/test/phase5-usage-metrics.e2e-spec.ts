import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { DataSource, In } from 'typeorm';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { Badge } from '../src/badges/entities/badge.entity';
import { BadgeAward } from '../src/badges/entities/badge-award.entity';
import {
  Challenge,
  ChallengeStatus,
} from '../src/challenges/entities/challenge.entity';
import { stockholmDateString } from '../src/common/time/stockholm-date.util';
import { buildUsageReportEmail } from '../src/mail/templates/usage-report-email.template';
import { ParentalConsentStatus } from '../src/players/player-consent-status.enum';
import { TeamJoinStatus } from '../src/players/team-join-status.enum';
import { Player } from '../src/players/entities/player.entity';
import { Season } from '../src/team-pool/entities/season.entity';
import { TeamSeasonPot } from '../src/team-pool/entities/team-season-pot.entity';
import { TeamSeasonPotStatus } from '../src/team-pool/team-season-pot-status.enum';
import { TeamChatMessage } from '../src/team-chat/entities/team-chat-message.entity';
import { Team } from '../src/teams/entities/team.entity';
import { ActivityType } from '../src/training-logs/activity-type.enum';
import { TrainingLogEntry } from '../src/training-logs/entities/training-log-entry.entity';
import { UsageMetricsQueryService } from '../src/usage-metrics/usage-metrics.query.service';
import { UsageMetricsService } from '../src/usage-metrics/usage-metrics.service';
import { formatUsageReportSections } from '../src/usage-metrics/usage-report-sections';
import { VideoClip } from '../src/video-clips/entities/video-clip.entity';

/**
 * docs/adr/0020-usage-analytics-product-metrics.md — the SQL half of
 * `usage-metrics/`, against a real Postgres.
 *
 * Why this file exists, from code-critic's review: every unit spec in that
 * module stubs UsageMetricsQueryService wholesale, so the one file whose
 * correctness TypeScript cannot establish — 400-odd lines of raw
 * `GROUP BY`/`FILTER` SQL — had no coverage at all. That is exactly where
 * the review's blocking finding lived (the weekly-goal metric counted
 * `status = 'completed'`, which nothing in this app ever writes, instead of
 * ADR-0015's real per-player-completion signal `goal_bonus_awarded_at`), and
 * the scheduled job swallows every failure by design, so a repeat would
 * surface as one ERROR line a month and nothing else.
 *
 * **Assertion strategy**, since this suite shares one Postgres with every
 * other e2e file and jest runs those files in parallel workers:
 *
 * - the two team-grouped queries (funnel, weekly goal) are asserted
 *   EXACTLY, on this suite's own fixture teams' rows — no other suite can
 *   touch them, so those numbers are fully deterministic;
 * - the app-wide queries are asserted on shape plus this suite's own
 *   contribution being present (a distinctive streak value, badge, points
 *   total, week) — never on a global total or a before/after delta, which
 *   another suite inserting or erasing rows concurrently could move.
 */
describe('Fas 5: usage-metrics queries (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let queryService: UsageMetricsQueryService;
  let usageMetricsService: UsageMetricsService;

  const createdTeamIds: string[] = [];
  let badgeId: string;

  // Distinctive fixture values, so an app-wide query's result can be
  // recognised as containing this suite's own rows without asserting
  // anything about the rest of the database.
  const FIXTURE_STREAK = 977;
  const FIXTURE_POT_POINTS = 1_234_567;
  const FIXTURE_BADGE_KEY = `usage_metrics_e2e_${randomUUID().slice(0, 8)}`;
  // Never selected by any query in this module — asserted absent from the
  // rendered report below (ADR-0020 Decision 1: "never `content`").
  const FIXTURE_CHAT_CONTENT = 'usage-metrics-e2e-secret-chat-content';
  const FIXTURE_TEAM_NAME = `UM E2E Team ${randomUUID().slice(0, 8)}`;
  const FIXTURE_SCREEN_NAME = `UMScreen${randomUUID().slice(0, 8)}`;

  const today = stockholmDateString(new Date());
  const daysAgo = (days: number): string => {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
  };

  let teamMetId: string;
  let teamMissedId: string;
  let teamEndingTodayId: string;
  let teamOutsideWindowId: string;
  let teamStillRunningId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    queryService = app.get(UsageMetricsQueryService);
    usageMetricsService = app.get(UsageMetricsService);

    // One active goal per team is a DB-level invariant
    // (idx_challenge_one_active_goal_per_team), so each date/status case
    // below needs its own fixture team rather than several goals on one.
    teamMetId = await createTeam();
    teamMissedId = await createTeam();
    teamEndingTodayId = await createTeam();
    teamOutsideWindowId = await createTeam();
    teamStillRunningId = await createTeam();

    // --- teamMet: two approved players (one of whom has trained), one
    // still consent-pending. Its goal ran to its end date and was met.
    const trainedPlayerId = await createPlayer(teamMetId, {
      screenName: FIXTURE_SCREEN_NAME,
      currentStreakCount: FIXTURE_STREAK,
      longestStreakCount: FIXTURE_STREAK,
    });
    await createPlayer(teamMetId, {});
    await createPlayer(teamMetId, {
      parentalConsentStatus: ParentalConsentStatus.PENDING,
      teamJoinStatus: TeamJoinStatus.PENDING,
    });

    await createTrainingLog(teamMetId, trainedPlayerId, ActivityType.DRILL);
    await createTrainingLog(teamMetId, trainedPlayerId, ActivityType.RUNNING);

    await createChallenge(teamMetId, {
      status: ChallengeStatus.ACTIVE,
      endDate: daysAgo(5),
      goalBonusAwardedAt: new Date(),
    });
    await createChallenge(teamMetId, {
      status: ChallengeStatus.CANCELLED,
      endDate: daysAgo(5),
    });
    await createChallenge(teamMetId, {
      status: ChallengeStatus.DRAFT,
      endDate: daysAgo(5),
    });

    // --- teamMissed: goal ran to its end date, nobody met it.
    await createPlayer(teamMissedId, {});
    await createChallenge(teamMissedId, {
      status: ChallengeStatus.ACTIVE,
      endDate: daysAgo(3),
    });

    // --- the three exclusion cases, one team each.
    await createChallenge(teamEndingTodayId, {
      status: ChallengeStatus.ACTIVE,
      endDate: today,
      goalBonusAwardedAt: new Date(),
    });
    await createChallenge(teamOutsideWindowId, {
      status: ChallengeStatus.ACTIVE,
      endDate: daysAgo(45),
      goalBonusAwardedAt: new Date(),
    });
    await createChallenge(teamStillRunningId, {
      status: ChallengeStatus.ACTIVE,
      endDate: daysAgo(-3),
    });

    // --- app-wide fixtures: an active pot, a clip, a chat message, a badge
    // award.
    await createActivePot(teamMetId);
    await createClip(teamMetId, trainedPlayerId);
    await createChatMessage(teamMetId, trainedPlayerId);
    badgeId = await createBadgeAward(trainedPlayerId);
  }, 30_000);

  afterAll(async () => {
    if (createdTeamIds.length > 0) {
      // ON DELETE CASCADE from `team` reaches player/season/pot/challenge/
      // training_log_entry/video_clip/team_chat_message, and from `player`
      // reaches badge_award — so the badge catalog row (RESTRICT) can only
      // be removed after the teams are gone.
      await dataSource.getRepository(Team).delete({ id: In(createdTeamIds) });
    }
    if (badgeId) {
      await dataSource.getRepository(Badge).delete({ id: badgeId });
    }
    await app.close();
  });

  async function createTeam(): Promise<string> {
    const repository = dataSource.getRepository(Team);
    const team = await repository.save(
      repository.create({
        name: `${FIXTURE_TEAM_NAME} ${createdTeamIds.length}`,
        inviteCode: `UM${randomUUID().slice(0, 8).toUpperCase()}`,
      }),
    );
    createdTeamIds.push(team.id);
    return team.id;
  }

  async function createPlayer(
    teamId: string,
    overrides: Partial<Player>,
  ): Promise<string> {
    const repository = dataSource.getRepository(Player);
    const player = await repository.save(
      repository.create({
        teamId,
        screenName: `UM${randomUUID().slice(0, 10)}`,
        avatarId: 'fox',
        birthYear: 2013,
        parentalConsentStatus: ParentalConsentStatus.APPROVED,
        teamJoinStatus: TeamJoinStatus.APPROVED,
        ...overrides,
      }),
    );
    return player.id;
  }

  async function createTrainingLog(
    teamId: string,
    playerId: string,
    activityType: ActivityType,
  ): Promise<void> {
    const repository = dataSource.getRepository(TrainingLogEntry);
    await repository.save(
      repository.create({
        teamId,
        playerId,
        activityType,
        durationMinutes: 15,
        loggedAt: new Date(),
        challengeId: null,
      }),
    );
  }

  async function createChallenge(
    teamId: string,
    overrides: Partial<Challenge> & { endDate: string },
  ): Promise<void> {
    const repository = dataSource.getRepository(Challenge);
    await repository.save(
      repository.create({
        teamId,
        createdByPlayerId: null,
        title: 'UM e2e goal',
        description: 'usage-metrics e2e fixture',
        targetMetric: 'total_minutes',
        targetValue: 60,
        startDate: daysAgo(12),
        goalBonusAwardedAt: null,
        goalBonusPointsAwarded: null,
        ...overrides,
      }),
    );
  }

  async function createActivePot(teamId: string): Promise<void> {
    const seasonRepository = dataSource.getRepository(Season);
    const season = await seasonRepository.save(
      seasonRepository.create({
        teamId,
        label: 'UM e2e season',
        startDate: daysAgo(28),
        endDate: daysAgo(-90),
      }),
    );
    const potRepository = dataSource.getRepository(TeamSeasonPot);
    await potRepository.save(
      potRepository.create({
        teamId,
        seasonId: season.id,
        pointsTotal: FIXTURE_POT_POINTS,
        goalThreshold: 9_999_999,
        status: TeamSeasonPotStatus.ACTIVE,
      }),
    );
  }

  async function createClip(
    teamId: string,
    uploaderPlayerId: string,
  ): Promise<void> {
    const repository = dataSource.getRepository(VideoClip);
    await repository.save(
      repository.create({
        teamId,
        uploaderPlayerId,
        taggedPlayerId: null,
        storageKey: `clips/${teamId}/${randomUUID()}.mp4`,
        mimeType: 'video/mp4',
        fileSizeBytes: 1024,
        durationSeconds: 10,
        caption: null,
      }),
    );
  }

  async function createChatMessage(
    teamId: string,
    senderPlayerId: string,
  ): Promise<void> {
    const repository = dataSource.getRepository(TeamChatMessage);
    await repository.save(
      repository.create({
        teamId,
        senderPlayerId,
        content: FIXTURE_CHAT_CONTENT,
        clipId: null,
      }),
    );
  }

  async function createBadgeAward(playerId: string): Promise<string> {
    const badgeRepository = dataSource.getRepository(Badge);
    const badge = await badgeRepository.save(
      badgeRepository.create({
        key: FIXTURE_BADGE_KEY,
        displayName: 'UM e2e badge',
        description: 'usage-metrics e2e fixture',
        icon: 'star',
      }),
    );
    const awardRepository = dataSource.getRepository(BadgeAward);
    await awardRepository.save(
      awardRepository.create({
        playerId,
        badgeId: badge.id,
        context: { triggerReason: 'system' },
        awardedBy: 'system',
      }),
    );
    return badge.id;
  }

  const windowStart = (): Date => new Date(Date.now() - 30 * 86_400_000);

  // --- Metric 5: the query the blocking finding was about ------------------

  describe('queryWeeklyGoalOutcomeRows', () => {
    it('counts a goal met under ADR-0015"s per-player definition (goal_bonus_awarded_at), which is what this app actually writes', async () => {
      const rows = await queryService.queryWeeklyGoalOutcomeRows(
        daysAgo(30),
        today,
      );
      const row = rows.find((entry) => entry.teamId === teamMetId);

      // The met goal is `status = 'active'` with a bonus timestamp — the
      // shape every real met goal in this app has, and the one the previous
      // implementation scored as 0.
      expect(row).toEqual({
        teamId: teamMetId,
        concludedGoalCount: 1,
        completedGoalCount: 1,
        // The cancelled goal is counted here and NOWHERE in the rate.
        cancelledGoalCount: 1,
      });
    });

    it('counts a goal that ran to its end date but was never met as concluded-not-completed', async () => {
      const rows = await queryService.queryWeeklyGoalOutcomeRows(
        daysAgo(30),
        today,
      );

      expect(rows.find((entry) => entry.teamId === teamMissedId)).toEqual({
        teamId: teamMissedId,
        concludedGoalCount: 1,
        completedGoalCount: 0,
        cancelledGoalCount: 0,
      });
    });

    it('excludes a goal still running, one ending today, and one outside the window entirely', async () => {
      const rows = await queryService.queryWeeklyGoalOutcomeRows(
        daysAgo(30),
        today,
      );
      const teamIds = rows.map((entry) => entry.teamId);

      // A goal ending today still has hours left to be met — counting it
      // would make the printed caveat a lie (and every rate pessimistic).
      expect(teamIds).not.toContain(teamEndingTodayId);
      expect(teamIds).not.toContain(teamOutsideWindowId);
      expect(teamIds).not.toContain(teamStillRunningId);
    });

    it('never counts a draft goal as an attempt', async () => {
      // teamMet has exactly one draft goal, inside the window, and its
      // concludedGoalCount is 1 (the active one) — proven by the first test
      // in this block. Asserted again explicitly against the raw table so
      // the reason for the number is unambiguous.
      const draftCount = await dataSource
        .getRepository(Challenge)
        .countBy({ teamId: teamMetId, status: ChallengeStatus.DRAFT });
      expect(draftCount).toBe(1);
    });
  });

  // --- Metric 1 --------------------------------------------------------------

  describe('queryAdoptionFunnelRows', () => {
    it('returns one already-aggregated row per (team, consent status, join status), with no per-player or team-name column', async () => {
      const rows = await queryService.queryAdoptionFunnelRows();
      const mine = rows.filter((row) => row.teamId === teamMetId);

      expect(mine).toHaveLength(2);
      expect(mine).toContainEqual({
        teamId: teamMetId,
        parentalConsentStatus: ParentalConsentStatus.APPROVED,
        teamJoinStatus: TeamJoinStatus.APPROVED,
        playerCount: 2,
        // Exactly one of the two approved players has ever logged training.
        playersWithAtLeastOneTrainingLog: 1,
      });
      expect(mine).toContainEqual({
        teamId: teamMetId,
        parentalConsentStatus: ParentalConsentStatus.PENDING,
        teamJoinStatus: TeamJoinStatus.PENDING,
        playerCount: 1,
        playersWithAtLeastOneTrainingLog: 0,
      });
      expect(Object.keys(mine[0]).sort()).toEqual([
        'parentalConsentStatus',
        'playerCount',
        'playersWithAtLeastOneTrainingLog',
        'teamId',
        'teamJoinStatus',
      ]);
    });
  });

  // --- Metrics 2, 3, 4, 6, 7, 8: app-wide queries ---------------------------

  describe('queryCurrentStreakValueCounts / queryLongestStreakValueCounts', () => {
    it('returns counts grouped by streak value — never a row per player', async () => {
      const current = await queryService.queryCurrentStreakValueCounts();
      const longest = await queryService.queryLongestStreakValueCounts();

      const mine = current.find((row) => row.streakCount === FIXTURE_STREAK);
      expect(mine).toBeDefined();
      expect(mine?.playerCount).toBeGreaterThanOrEqual(1);
      expect(Object.keys(mine ?? {}).sort()).toEqual([
        'playerCount',
        'streakCount',
      ]);
      // One row per DISTINCT value is what makes this an aggregate at all.
      expect(new Set(current.map((row) => row.streakCount)).size).toBe(
        current.length,
      );
      expect(
        longest.find((row) => row.streakCount === FIXTURE_STREAK),
      ).toBeDefined();
    });
  });

  describe('queryActivityRecency', () => {
    it('returns one row of three consistent counts', async () => {
      const row = await queryService.queryActivityRecency(
        new Date(Date.now() - 7 * 86_400_000),
        windowStart(),
      );

      expect(Object.keys(row).sort()).toEqual([
        'playersActiveInWindow',
        'playersActiveLast7Days',
        'totalPlayers',
      ]);
      // This suite alone contributes four players and one of them trained
      // today, so these are lower bounds that hold under any concurrency.
      expect(row.totalPlayers).toBeGreaterThanOrEqual(4);
      expect(row.playersActiveLast7Days).toBeGreaterThanOrEqual(1);
      expect(row.playersActiveInWindow).toBeGreaterThanOrEqual(
        row.playersActiveLast7Days,
      );
      expect(row.totalPlayers).toBeGreaterThanOrEqual(
        row.playersActiveInWindow,
      );
    });
  });

  describe('queryTrainingTypeMix', () => {
    it('groups by the activity_type enum only, with this run"s two logs included', async () => {
      const rows = await queryService.queryTrainingTypeMix(windowStart());
      const types = rows.map((row) => row.activityType);

      expect(types).toContain(ActivityType.DRILL);
      expect(types).toContain(ActivityType.RUNNING);
      for (const row of rows) {
        expect(Object.values(ActivityType)).toContain(row.activityType);
        expect(row.logCount).toBeGreaterThanOrEqual(1);
        expect(Object.keys(row).sort()).toEqual(['activityType', 'logCount']);
      }
      expect(new Set(types).size).toBe(types.length);
    });
  });

  describe('queryActivePotGrowthRows', () => {
    it('returns points/season-start pairs for active pots — and no team identifier at all', async () => {
      const rows = await queryService.queryActivePotGrowthRows();
      const mine = rows.filter((row) => row.pointsTotal === FIXTURE_POT_POINTS);

      expect(mine).toHaveLength(1);
      expect(mine[0].seasonStartDate).toBe(daysAgo(28));
      expect(Object.keys(mine[0]).sort()).toEqual([
        'pointsTotal',
        'seasonStartDate',
      ]);
    });
  });

  describe('queryClipUploadsPerWeek / queryChatMessagesPerWeek', () => {
    it('returns week-start/count pairs only — no caption, no content, no ids', async () => {
      const clips = await queryService.queryClipUploadsPerWeek(windowStart());
      const messages =
        await queryService.queryChatMessagesPerWeek(windowStart());

      for (const row of [...clips, ...messages]) {
        expect(Object.keys(row).sort()).toEqual(['count', 'weekStart']);
        expect(row.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      // date_trunc('week', ...) is always a Monday.
      for (const row of [...clips, ...messages]) {
        expect(new Date(`${row.weekStart}T00:00:00Z`).getUTCDay()).toBe(1);
      }
      // This run just inserted one of each, so the current week is present.
      expect(clips.length).toBeGreaterThanOrEqual(1);
      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(messages)).not.toContain(FIXTURE_CHAT_CONTENT);
    });
  });

  describe('queryBadgeMix', () => {
    it('groups awards by badge, resolving the fixed catalog key', async () => {
      const rows = await queryService.queryBadgeMix(windowStart());
      const mine = rows.find((row) => row.badgeId === badgeId);

      expect(mine).toEqual({
        badgeId,
        badgeKey: FIXTURE_BADGE_KEY,
        awardCount: 1,
      });
    });
  });

  // --- The whole thing, against the real database ---------------------------

  describe('UsageMetricsService.collect', () => {
    it('produces a complete report from real data, and the rendered email leaks no child-level value', async () => {
      const report = await usageMetricsService.collect();

      expect(report.windowDays).toBe(30);
      expect(report.totalTeams).toBeGreaterThanOrEqual(5);
      expect(report.adoptionFunnel.appWide.totalPlayers).toBeGreaterThanOrEqual(
        4,
      );
      expect(report.streakHealth.currentStreakHistogram).toHaveLength(6);
      // This suite's own met/missed goals are in the app-wide figures.
      expect(
        report.weeklyGoalEngagement.appWide.concludedGoalCount,
      ).toBeGreaterThanOrEqual(2);
      expect(
        report.weeklyGoalEngagement.appWide.completedGoalCount,
      ).toBeGreaterThanOrEqual(1);
      expect(
        report.weeklyGoalEngagement.appWide.cancelledGoalCount,
      ).toBeGreaterThanOrEqual(1);

      const email = buildUsageReportEmail(formatUsageReportSections(report));
      const rendered = `${email.subject}\n${email.text}\n${email.html}`;

      // Decision 3, enforced end-to-end rather than only in the unit tests:
      // nothing that identifies a team or a child may survive into the
      // report, however the numbers were computed.
      expect(rendered).not.toContain(FIXTURE_TEAM_NAME);
      expect(rendered).not.toContain(FIXTURE_SCREEN_NAME);
      expect(rendered).not.toContain(FIXTURE_CHAT_CONTENT);
      for (const teamId of createdTeamIds) {
        expect(rendered).not.toContain(teamId);
      }
    }, 30_000);
  });
});
