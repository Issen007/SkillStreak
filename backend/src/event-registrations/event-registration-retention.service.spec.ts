import { FindOperator } from 'typeorm';
import { EventRegistrationRetentionService } from './event-registration-retention.service';
import { DEFAULT_EVENT_REGISTRATION_RETENTION_DAYS } from './event-registrations.constants';

function buildService(
  overrides: {
    configValue?: string;
    registrations?: Record<string, jest.Mock>;
    redisService?: Record<string, jest.Mock>;
  } = {},
) {
  const registrations = {
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    ...overrides.registrations,
  };
  const configService = {
    get: jest.fn().mockReturnValue(overrides.configValue),
  };
  const errorLogService = { record: jest.fn().mockResolvedValue(undefined) };
  const redisService = {
    // Wins the run claim by default; the lock behaviour has its own tests
    // below, matching the convention in the other sweeps' specs.
    tryClaimScheduledJobRun: jest.fn().mockResolvedValue(true),
    ...overrides.redisService,
  };

  const service = new EventRegistrationRetentionService(
    registrations as never,
    configService as never,
    errorLogService as never,
    redisService as never,
  );

  return { service, registrations, errorLogService, redisService };
}

function cutoffPassedTo(repository: Record<string, jest.Mock>): Date {
  const [[criteria]] = repository.delete.mock.calls as [
    [{ createdAt: FindOperator<Date> }],
  ];
  return criteria.createdAt.value;
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe('EventRegistrationRetentionService.sweepExpiredRegistrations', () => {
  it('deletes registrations older than the default 365-day cutoff', async () => {
    const before = Date.now();
    const { service, registrations } = buildService();

    await service.sweepExpiredRegistrations();

    const cutoff = cutoffPassedTo(registrations);
    const expected =
      before - DEFAULT_EVENT_REGISTRATION_RETENTION_DAYS * DAY_MS;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(expected - 5_000);
    expect(cutoff.getTime()).toBeLessThanOrEqual(expected + 5_000);
  });

  it('honours an explicit EVENT_REGISTRATION_RETENTION_DAYS', async () => {
    const before = Date.now();
    const { service, registrations } = buildService({ configValue: '30' });

    await service.sweepExpiredRegistrations();

    const cutoff = cutoffPassedTo(registrations);
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(
      before - 30 * DAY_MS - 5_000,
    );
    expect(cutoff.getTime()).toBeLessThanOrEqual(before - 30 * DAY_MS + 5_000);
  });

  it.each(['', 'soon', '0', '-5', '1.5'])(
    'falls back to the default rather than crashing on %p',
    async (configValue) => {
      const { service, registrations } = buildService({ configValue });

      await service.sweepExpiredRegistrations();

      const cutoff = cutoffPassedTo(registrations);
      const expected =
        Date.now() - DEFAULT_EVENT_REGISTRATION_RETENTION_DAYS * DAY_MS;
      expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(5_000);
    },
  );

  it('deletes by age alone — never narrowed by campaign or interest', async () => {
    const { service, registrations } = buildService();

    await service.sweepExpiredRegistrations();

    // A "keep the investors longer" rule would turn one retention promise
    // into a per-person one based on a dropdown the form never explained.
    const [[criteria]] = registrations.delete.mock.calls as [
      [Record<string, unknown>],
    ];
    expect(Object.keys(criteria)).toEqual(['createdAt']);
  });

  it('skips the tick when another replica already claimed the run', async () => {
    const { service, registrations } = buildService({
      redisService: {
        tryClaimScheduledJobRun: jest.fn().mockResolvedValue(false),
      },
    });

    await service.sweepExpiredRegistrations();

    expect(registrations.delete).not.toHaveBeenCalled();
  });

  it('skips the tick when Redis itself is unreachable', async () => {
    const { service, registrations, errorLogService } = buildService({
      redisService: {
        tryClaimScheduledJobRun: jest
          .fn()
          .mockRejectedValue(new Error('redis down')),
      },
    });

    await expect(service.sweepExpiredRegistrations()).resolves.toBeUndefined();
    expect(registrations.delete).not.toHaveBeenCalled();
    // A lock check that could not run is not a job failure — nothing was
    // attempted, so there is nothing to report.
    expect(errorLogService.record).not.toHaveBeenCalled();
  });

  it('records a failed sweep instead of rejecting, and leaves it for the next run', async () => {
    const { service, errorLogService } = buildService({
      registrations: {
        delete: jest.fn().mockRejectedValue(new Error('deadlock detected')),
      },
    });

    await expect(service.sweepExpiredRegistrations()).resolves.toBeUndefined();
    expect(errorLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'job',
        jobName: 'event-registration:retention',
      }),
    );
  });

  it('claims the run under the same name it reports failures under', async () => {
    const { service, redisService } = buildService();

    await service.sweepExpiredRegistrations();

    // One vocabulary for "which job is this" — a stuck Redis lock key and
    // an admin-console error row have to name the same thing.
    expect(redisService.tryClaimScheduledJobRun).toHaveBeenCalledWith(
      'event-registration:retention',
      expect.any(Number),
    );
  });
});
