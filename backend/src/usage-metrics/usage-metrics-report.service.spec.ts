import { UsageMetricsReportService } from './usage-metrics-report.service';
import { UsageMetricsReport } from './usage-metrics.types';

function emptyReport(): UsageMetricsReport {
  return {
    generatedAt: new Date('2026-08-01T06:00:00.000Z'),
    windowStart: new Date('2026-07-02T06:00:00.000Z'),
    windowDays: 30,
    minTeamsPerBucket: 5,
    totalTeams: 3,
    adoptionFunnel: {
      appWide: {
        totalPlayers: 0,
        playersByParentalConsentStatus: {
          not_requested: 0,
          pending: 0,
          approved: 0,
          revoked: 0,
        },
        playersByTeamJoinStatus: { pending: 0, approved: 0, rejected: 0 },
        playersWithAtLeastOneTrainingLog: 0,
        percentWithAtLeastOneTrainingLog: 0,
      },
      byTeamSizeBucket: [],
      foldedIntoAppWide: false,
    },
    streakHealth: {
      totalPlayers: 0,
      currentStreakHistogram: [],
      longestStreakHistogram: [],
    },
    activityRecency: {
      totalPlayers: 0,
      playersActiveLast7Days: 0,
      percentActiveLast7Days: 0,
      playersActiveInWindow: 0,
      percentActiveInWindow: 0,
    },
    trainingTypeMix: [],
    weeklyGoalEngagement: {
      appWide: {
        concludedGoalCount: 0,
        completedGoalCount: 0,
        percentCompleted: 0,
        cancelledGoalCount: 0,
      },
      byTeamSizeBucket: [],
      foldedIntoAppWide: false,
    },
    teamPoolGrowth: {
      activePotCount: 0,
      medianPointsPerWeek: 0,
      histogram: [],
    },
    socialUsage: { clipUploadsPerWeek: [], chatMessagesPerWeek: [] },
    badgeMix: [],
  };
}

function buildService(overrides: {
  config?: Record<string, string>;
  usageMetricsService?: Record<string, jest.Mock>;
  mailService?: Record<string, jest.Mock>;
  redisService?: Record<string, jest.Mock>;
}) {
  const configService = {
    get: jest.fn((key: string) => overrides.config?.[key]),
  };
  const usageMetricsService = {
    collect: jest.fn().mockResolvedValue(emptyReport()),
    ...overrides.usageMetricsService,
  };
  const mailService = {
    sendMail: jest.fn().mockResolvedValue(undefined),
    ...overrides.mailService,
  };
  const redisService = {
    // Wins the scheduled-job-run claim by default — see the dedicated
    // "another replica already claimed this run" test below.
    tryClaimScheduledJobRun: jest.fn().mockResolvedValue(true),
    ...overrides.redisService,
  };

  const service = new UsageMetricsReportService(
    configService as never,
    usageMetricsService as never,
    mailService as never,
    redisService as never,
  );

  return { service, usageMetricsService, mailService, redisService };
}

// docs/adr/0020-usage-analytics-product-metrics.md Decision 5 — the
// scheduled job's own behaviour: multi-replica safety, and the two
// graceful-degradation paths that must never take the API down.
describe('UsageMetricsReportService.sendScheduledReport', () => {
  it('computes the report and emails it to USAGE_REPORT_RECIPIENT_EMAIL', async () => {
    const { service, usageMetricsService, mailService } = buildService({
      config: { USAGE_REPORT_RECIPIENT_EMAIL: 'owner@example.com' },
    });

    await service.sendScheduledReport();

    expect(usageMetricsService.collect).toHaveBeenCalledTimes(1);
    expect(mailService.sendMail).toHaveBeenCalledTimes(1);
    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@example.com',
        subject: expect.stringContaining('Usage report') as string,
        text: expect.stringContaining('Adoption & consent funnel') as string,
        html: expect.stringContaining('SkillStreak usage report') as string,
      }),
    );
  });

  // The graceful-degradation path: the recipient is a Secret key the
  // project owner may simply not have set yet (k8s/api-deployment.yaml
  // marks it `optional: true`), so an unconfigured job must no-op, exactly
  // like MailService itself does when SMTP is unconfigured.
  it('no-ops without computing anything when USAGE_REPORT_RECIPIENT_EMAIL is unset', async () => {
    const { service, usageMetricsService, mailService } = buildService({});

    await expect(service.sendScheduledReport()).resolves.toBeUndefined();

    expect(usageMetricsService.collect).not.toHaveBeenCalled();
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  // A k8s Secret key created from an unset GitHub Actions secret arrives as
  // '' rather than absent (see config/env.validation.spec.ts) — that must
  // behave identically to unset, not send mail to an empty address.
  it('treats an empty-string recipient exactly like unset', async () => {
    const { service, mailService } = buildService({
      config: { USAGE_REPORT_RECIPIENT_EMAIL: '   ' },
    });

    await service.sendScheduledReport();

    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  // k8s/secret.yaml.example is copied by hand to create the internal
  // cluster's real Secret, so "still at the placeholder" is a genuinely
  // likely live state — and CHANGE_ME is a truthy string, so without this
  // the job would compute a full report over real child-derived data and
  // hand it to the SMTP relay addressed to nobody (security-reviewer and
  // code-critic raised this independently).
  it('treats the CHANGE_ME placeholder from k8s/secret.yaml.example as unset', async () => {
    const { service, usageMetricsService, mailService } = buildService({
      config: { USAGE_REPORT_RECIPIENT_EMAIL: 'CHANGE_ME' },
    });

    await service.sendScheduledReport();

    expect(usageMetricsService.collect).not.toHaveBeenCalled();
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  // nodemailer treats `to` as a LIST, so a hand-typed second address would
  // silently fan this report out to more mailboxes — ADR-0020 Decision 4's
  // "sole consumer: the project owner" quietly stops being true.
  it('refuses anything that is not exactly one address, rather than fanning the report out', async () => {
    for (const notOneAddress of [
      'owner@example.com, someone@else.com',
      'owner@example.com;someone@else.com',
      'owner@example.com someone@else.com',
      'Owner <owner@example.com>',
      'not-an-email',
      'owner@localhost',
    ]) {
      const { service, mailService } = buildService({
        config: { USAGE_REPORT_RECIPIENT_EMAIL: notOneAddress },
      });

      await expect(service.sendScheduledReport()).resolves.toBeUndefined();
      expect(mailService.sendMail).not.toHaveBeenCalled();
    }
  });

  it('accepts an ordinary single address, including a plus-tag and a subdomain', async () => {
    for (const address of [
      'owner+skillstreak@example.com',
      'owner@mail.example.co.uk',
    ]) {
      const { service, mailService } = buildService({
        config: { USAGE_REPORT_RECIPIENT_EMAIL: address },
      });

      await service.sendScheduledReport();

      expect(mailService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: address }),
      );
    }
  });

  // k8s/README.md's "Scheduled-job races" note — with 2+ api replicas, only
  // the one that wins the Redis try-lock should compute/send the report.
  it("skips entirely when another replica already claimed this run's lock", async () => {
    const { service, usageMetricsService, mailService, redisService } =
      buildService({
        config: { USAGE_REPORT_RECIPIENT_EMAIL: 'owner@example.com' },
        redisService: {
          tryClaimScheduledJobRun: jest.fn().mockResolvedValue(false),
        },
      });

    await service.sendScheduledReport();

    expect(redisService.tryClaimScheduledJobRun).toHaveBeenCalledWith(
      'usage-metrics:report',
      expect.any(Number),
    );
    expect(usageMetricsService.collect).not.toHaveBeenCalled();
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  // Same posture as ClipRetentionService/AccountErasureSweepService: a
  // rejected run-lock check (Redis briefly unreachable) degrades to "skip
  // this tick", never an unhandled rejection out of the @Cron handler.
  it('skips this tick, without throwing, if the Redis run-lock check itself fails', async () => {
    const { service, usageMetricsService } = buildService({
      config: { USAGE_REPORT_RECIPIENT_EMAIL: 'owner@example.com' },
      redisService: {
        tryClaimScheduledJobRun: jest
          .fn()
          .mockRejectedValue(new Error('redis unreachable')),
      },
    });

    await expect(service.sendScheduledReport()).resolves.toBeUndefined();
    expect(usageMetricsService.collect).not.toHaveBeenCalled();
  });

  it('logs and swallows a failure to compute the report — a monthly report must never crash the API', async () => {
    const { service, mailService } = buildService({
      config: { USAGE_REPORT_RECIPIENT_EMAIL: 'owner@example.com' },
      usageMetricsService: {
        collect: jest.fn().mockRejectedValue(new Error('postgres unreachable')),
      },
    });

    await expect(service.sendScheduledReport()).resolves.toBeUndefined();
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('logs and swallows an SMTP failure too', async () => {
    const { service } = buildService({
      config: { USAGE_REPORT_RECIPIENT_EMAIL: 'owner@example.com' },
      mailService: {
        sendMail: jest.fn().mockRejectedValue(new Error('smtp timeout')),
      },
    });

    await expect(service.sendScheduledReport()).resolves.toBeUndefined();
  });

  it('boots (onModuleInit) without throwing whether or not a recipient is configured', () => {
    expect(() => buildService({}).service.onModuleInit()).not.toThrow();
    expect(() =>
      buildService({
        config: { USAGE_REPORT_RECIPIENT_EMAIL: 'owner@example.com' },
      }).service.onModuleInit(),
    ).not.toThrow();
  });
});
