import { FindOperator } from 'typeorm';
import { ImprovementSuggestionRetentionService } from './improvement-suggestion-retention.service';
import { DEFAULT_IMPROVEMENT_SUGGESTION_RETENTION_DAYS } from './improvement-suggestions.constants';

function buildService(
  overrides: {
    configValue?: string;
    improvementSuggestionRepository?: Record<string, jest.Mock>;
    redisService?: Record<string, jest.Mock>;
  } = {},
) {
  const improvementSuggestionRepository = {
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    ...overrides.improvementSuggestionRepository,
  };
  const configService = {
    get: jest.fn().mockReturnValue(overrides.configValue),
  };
  const errorLogService = { record: jest.fn().mockResolvedValue(undefined) };
  const redisService = {
    // Wins the scheduled-job-run claim by default — see the dedicated lock
    // test below, matching the sibling sweeps' spec convention.
    tryClaimScheduledJobRun: jest.fn().mockResolvedValue(true),
    ...overrides.redisService,
  };

  const service = new ImprovementSuggestionRetentionService(
    improvementSuggestionRepository as never,
    configService as never,
    errorLogService as never,
    redisService as never,
  );

  return {
    service,
    improvementSuggestionRepository,
    errorLogService,
    redisService,
  };
}

function cutoffPassedTo(repository: Record<string, jest.Mock>): Date {
  const [[criteria]] = repository.delete.mock.calls as [
    [{ createdAt: FindOperator<Date> }],
  ];
  return criteria.createdAt.value;
}

describe('ImprovementSuggestionRetentionService', () => {
  it('deletes suggestions older than the default 90-day cutoff', async () => {
    const before = Date.now();
    const { service, improvementSuggestionRepository } = buildService();

    await service.sweepExpiredImprovementSuggestions();

    const cutoff = cutoffPassedTo(improvementSuggestionRepository);
    const expected =
      before -
      DEFAULT_IMPROVEMENT_SUGGESTION_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(expected - 5_000);
    expect(cutoff.getTime()).toBeLessThanOrEqual(expected + 5_000);
  });

  it('honours IMPROVEMENT_SUGGESTION_RETENTION_DAYS when it is a positive integer', async () => {
    const before = Date.now();
    const { service, improvementSuggestionRepository } = buildService({
      configValue: '30',
    });

    await service.sweepExpiredImprovementSuggestions();

    const cutoff = cutoffPassedTo(improvementSuggestionRepository);
    const expected = before - 30 * 24 * 60 * 60 * 1000;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(expected - 5_000);
    expect(cutoff.getTime()).toBeLessThanOrEqual(expected + 5_000);
  });

  // The empty-but-present case a k8s Secret key with no GitHub Actions
  // secret behind it actually delivers — must fall back, never crash and
  // never sweep with a nonsense cutoff.
  it.each(['', '  ', 'soon', '0', '-5', '1.5'])(
    'falls back to the default when the knob is %j',
    async (configValue) => {
      const before = Date.now();
      const { service, improvementSuggestionRepository } = buildService({
        configValue,
      });

      await service.sweepExpiredImprovementSuggestions();

      const cutoff = cutoffPassedTo(improvementSuggestionRepository);
      const expected =
        before -
        DEFAULT_IMPROVEMENT_SUGGESTION_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(expected - 5_000);
      expect(cutoff.getTime()).toBeLessThanOrEqual(expected + 5_000);
    },
  );

  it('does nothing when another replica already claimed the run', async () => {
    const { service, improvementSuggestionRepository } = buildService({
      redisService: {
        tryClaimScheduledJobRun: jest.fn().mockResolvedValue(false),
      },
    });

    await service.sweepExpiredImprovementSuggestions();

    expect(improvementSuggestionRepository.delete).not.toHaveBeenCalled();
  });

  it('records a durable failure row instead of rejecting when the DELETE fails', async () => {
    const { service, errorLogService } = buildService({
      improvementSuggestionRepository: {
        delete: jest.fn().mockRejectedValue(new Error('deadlock detected')),
      },
    });

    await expect(
      service.sweepExpiredImprovementSuggestions(),
    ).resolves.toBeUndefined();
    expect(errorLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'job',
        jobName: 'improvement-suggestion:retention',
      }),
    );
  });
});
