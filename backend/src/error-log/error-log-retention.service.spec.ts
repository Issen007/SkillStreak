import { ErrorLogRetentionService } from './error-log-retention.service';

function buildService(
  overrides: {
    retentionDays?: number;
    errorLogRepository?: Record<string, jest.Mock>;
    redisService?: Record<string, jest.Mock>;
  } = {},
) {
  const errorLogRepository = {
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    ...overrides.errorLogRepository,
  };
  const errorLogService = {
    retentionDays: jest.fn().mockReturnValue(overrides.retentionDays ?? 90),
    record: jest.fn().mockResolvedValue(undefined),
  };
  const redisService = {
    // Wins the scheduled-job-run claim by default — see the dedicated
    // lock tests below, matching ClipRetentionService's spec convention.
    tryClaimScheduledJobRun: jest.fn().mockResolvedValue(true),
    ...overrides.redisService,
  };

  const service = new ErrorLogRetentionService(
    errorLogRepository as never,
    errorLogService as never,
    redisService as never,
  );

  return { service, errorLogRepository, errorLogService, redisService };
}

// docs/adr/0022-admin-control-center.md Decision 6's retention sweep.
describe('ErrorLogRetentionService.sweepExpiredErrorLogEntries', () => {
  it('deletes rows older than the configured cutoff', async () => {
    const before = Date.now();
    const { service, errorLogRepository } = buildService({ retentionDays: 90 });

    await service.sweepExpiredErrorLogEntries();
    const after = Date.now();

    expect(errorLogRepository.delete).toHaveBeenCalledTimes(1);
    // Same technique as clip-retention.service.spec.ts: TypeORM's
    // LessThan() wraps the cutoff in a FindOperator whose internal value
    // isn't public API, so assert the cutoff lands ~90 days in the past
    // relative to when this test ran.
    const [[where]] = errorLogRepository.delete.mock.calls as [
      [{ occurredAt: { _value: Date } }],
    ];
    const cutoffMs = where.occurredAt._value.getTime();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    expect(cutoffMs).toBeGreaterThanOrEqual(before - ninetyDaysMs - 1000);
    expect(cutoffMs).toBeLessThanOrEqual(after - ninetyDaysMs + 1000);
  });

  it('honours a non-default retention window', async () => {
    const before = Date.now();
    const { service, errorLogRepository } = buildService({ retentionDays: 7 });

    await service.sweepExpiredErrorLogEntries();
    const after = Date.now();

    const [[where]] = errorLogRepository.delete.mock.calls as [
      [{ occurredAt: { _value: Date } }],
    ];
    const cutoffMs = where.occurredAt._value.getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(cutoffMs).toBeGreaterThanOrEqual(before - sevenDaysMs - 1000);
    expect(cutoffMs).toBeLessThanOrEqual(after - sevenDaysMs + 1000);
  });

  // k8s/api-deployment.yaml runs `replicas: 2` — without the claim, both
  // pods would run the same DELETE.
  it("skips entirely when another replica already claimed this run's lock", async () => {
    const { service, errorLogRepository, redisService } = buildService({
      redisService: {
        tryClaimScheduledJobRun: jest.fn().mockResolvedValue(false),
      },
    });

    await service.sweepExpiredErrorLogEntries();

    expect(redisService.tryClaimScheduledJobRun).toHaveBeenCalledWith(
      'error-log:retention',
      expect.any(Number),
    );
    expect(errorLogRepository.delete).not.toHaveBeenCalled();
  });

  // Same code-critic-driven posture as the other three sweeps: a Redis
  // hiccup degrades to "skip this tick", never rejects out of the @Cron
  // handler.
  it('skips this tick, without throwing, if the Redis run-lock check itself fails', async () => {
    const { service, errorLogRepository } = buildService({
      redisService: {
        tryClaimScheduledJobRun: jest
          .fn()
          .mockRejectedValue(new Error('redis unreachable')),
      },
    });

    await expect(
      service.sweepExpiredErrorLogEntries(),
    ).resolves.toBeUndefined();

    expect(errorLogRepository.delete).not.toHaveBeenCalled();
  });

  it('records its own failure as a job row and does not rethrow', async () => {
    const failure = new Error('deadlock detected');
    const { service, errorLogService } = buildService({
      errorLogRepository: { delete: jest.fn().mockRejectedValue(failure) },
    });

    await expect(
      service.sweepExpiredErrorLogEntries(),
    ).resolves.toBeUndefined();

    expect(errorLogService.record).toHaveBeenCalledWith({
      source: 'job',
      jobName: 'error-log:retention',
      error: failure,
    });
  });
});
