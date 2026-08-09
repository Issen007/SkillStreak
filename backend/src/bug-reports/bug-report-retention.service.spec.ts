import { FindOperator } from 'typeorm';
import { BugReportRetentionService } from './bug-report-retention.service';
import { DEFAULT_BUG_REPORT_RETENTION_DAYS } from './bug-reports.constants';

function buildService(
  overrides: {
    configValue?: string;
    bugReportRepository?: Record<string, jest.Mock>;
    redisService?: Record<string, jest.Mock>;
  } = {},
) {
  const bugReportRepository = {
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    ...overrides.bugReportRepository,
  };
  const configService = {
    get: jest.fn().mockReturnValue(overrides.configValue),
  };
  const errorLogService = { record: jest.fn().mockResolvedValue(undefined) };
  const redisService = {
    // Wins the scheduled-job-run claim by default — see the dedicated lock
    // tests below, matching ClipRetentionService's spec convention.
    tryClaimScheduledJobRun: jest.fn().mockResolvedValue(true),
    ...overrides.redisService,
  };

  const service = new BugReportRetentionService(
    bugReportRepository as never,
    configService as never,
    errorLogService as never,
    redisService as never,
  );

  return { service, bugReportRepository, errorLogService, redisService };
}

function cutoffPassedTo(repository: Record<string, jest.Mock>): Date {
  const [[criteria]] = repository.delete.mock.calls as [
    [{ createdAt: FindOperator<Date> }],
  ];
  return criteria.createdAt.value;
}

// The retention bound `bug_report` was missing — the one table holding
// child-authored free text with no cutoff, while clips and error_log_entry
// both have one (security-reviewer, 2026-08-08).
describe('BugReportRetentionService.sweepExpiredBugReports', () => {
  it('deletes reports older than the default 90-day cutoff', async () => {
    const before = Date.now();
    const { service, bugReportRepository } = buildService();

    await service.sweepExpiredBugReports();

    const cutoff = cutoffPassedTo(bugReportRepository);
    const expected =
      before - DEFAULT_BUG_REPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(expected - 5_000);
    expect(cutoff.getTime()).toBeLessThanOrEqual(expected + 5_000);
  });

  it('honours BUG_REPORT_RETENTION_DAYS', async () => {
    const before = Date.now();
    const { service, bugReportRepository } = buildService({
      configValue: '30',
    });

    await service.sweepExpiredBugReports();

    const cutoff = cutoffPassedTo(bugReportRepository);
    const expected = before - 30 * 24 * 60 * 60 * 1000;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(expected - 5_000);
    expect(cutoff.getTime()).toBeLessThanOrEqual(expected + 5_000);
  });

  // The empty-but-present case a k8s Secret key with no value behind it (or
  // docker-compose's `${VAR:-}`) actually delivers. It must fall back, not
  // parse to 0 and delete everything ever written.
  it.each(['', '   ', 'ninety', '0', '-5', '1.5'])(
    'falls back to the default for the unusable config value %p',
    async (configValue) => {
      const before = Date.now();
      const { service, bugReportRepository } = buildService({ configValue });

      await service.sweepExpiredBugReports();

      const cutoff = cutoffPassedTo(bugReportRepository);
      const expected =
        before - DEFAULT_BUG_REPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(expected - 5_000);
    },
  );

  // Sweeping by age alone is the point: a retention promise that an
  // operator defeats by never touching a report is not a promise. The
  // delete criteria must carry no status filter at all.
  it('deletes by age regardless of status — no status filter in the criteria', async () => {
    const { service, bugReportRepository } = buildService();

    await service.sweepExpiredBugReports();

    const [[criteria]] = bugReportRepository.delete.mock.calls as [
      [Record<string, unknown>],
    ];
    expect(Object.keys(criteria)).toEqual(['createdAt']);
  });

  it("skips entirely when another replica already claimed this run's lock", async () => {
    const { service, bugReportRepository } = buildService({
      redisService: {
        tryClaimScheduledJobRun: jest.fn().mockResolvedValue(false),
      },
    });

    await service.sweepExpiredBugReports();

    expect(bugReportRepository.delete).not.toHaveBeenCalled();
  });

  it('skips this tick when the Redis lock check itself fails, without rejecting', async () => {
    const { service, bugReportRepository } = buildService({
      redisService: {
        tryClaimScheduledJobRun: jest
          .fn()
          .mockRejectedValue(new Error('redis unreachable')),
      },
    });

    await expect(service.sweepExpiredBugReports()).resolves.toBeUndefined();
    expect(bugReportRepository.delete).not.toHaveBeenCalled();
  });

  // A failed sweep gets a run-level error_log_entry row rather than
  // disappearing into an unobserved rejected promise — same discipline as
  // every other scheduled job since ADR-0022 Decision 6.
  it('records a run-level failure and leaves the rows for the next run', async () => {
    const failure = new Error('deadlock detected');
    const { service, errorLogService } = buildService({
      bugReportRepository: { delete: jest.fn().mockRejectedValue(failure) },
    });

    await expect(service.sweepExpiredBugReports()).resolves.toBeUndefined();

    expect(errorLogService.record).toHaveBeenCalledWith({
      source: 'job',
      jobName: 'bug-report:retention',
      error: failure,
    });
  });
});
