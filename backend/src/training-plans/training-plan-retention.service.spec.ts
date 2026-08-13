import { ConfigService } from '@nestjs/config';
import { ERROR_LOG_JOB_NAMES } from '../error-log/error-log.constants';
import { TrainingPlanRetentionService } from './training-plan-retention.service';
import { DEFAULT_TRAINING_PLAN_RETENTION_DAYS } from './training-plans.constants';

describe('TrainingPlanRetentionService', () => {
  let del: jest.Mock;
  let record: jest.Mock;
  let claim: jest.Mock;
  let config: Record<string, string>;
  let service: TrainingPlanRetentionService;

  beforeEach(() => {
    config = {};
    del = jest.fn().mockResolvedValue({ affected: 2 });
    record = jest.fn().mockResolvedValue(undefined);
    claim = jest.fn().mockResolvedValue(true);

    service = new TrainingPlanRetentionService(
      { delete: del } as never,
      { get: (key: string) => config[key] } as unknown as ConfigService,
      { record } as never,
      {
        tryClaimScheduledJobRun: claim,
        claimScheduledJobRun: claim,
      } as never,
    );
  });

  function cutoffFrom(mock: jest.Mock): Date {
    const criteria = (
      mock.mock.calls[0] as [{ createdAt: { value: Date } }]
    )[0];
    return criteria.createdAt.value;
  }

  it('deletes plans older than the default window', async () => {
    await service.sweepExpiredTrainingPlans();

    const days =
      (Date.now() - cutoffFrom(del).getTime()) / (24 * 60 * 60 * 1000);
    expect(Math.round(days)).toBe(DEFAULT_TRAINING_PLAN_RETENTION_DAYS);
  });

  it('keeps plans far longer than child-authored data', () => {
    // The one retention window in this app that goes UP rather than down.
    // A generated session is an adult's own work product about an age
    // band, so the analogue is a coach's notebook, not a clip.
    expect(DEFAULT_TRAINING_PLAN_RETENTION_DAYS).toBe(365);
  });

  it('honours a configured window', async () => {
    config['TRAINING_PLAN_RETENTION_DAYS'] = '30';
    await service.sweepExpiredTrainingPlans();
    const days =
      (Date.now() - cutoffFrom(del).getTime()) / (24 * 60 * 60 * 1000);
    expect(Math.round(days)).toBe(30);
  });

  it('falls back to the default on an empty value', async () => {
    // An empty-but-present value is exactly what a k8s Secret key with no
    // GitHub secret behind it delivers. It must mean "default", not zero
    // — zero would delete every plan ever generated on the next tick.
    config['TRAINING_PLAN_RETENTION_DAYS'] = '';
    await service.sweepExpiredTrainingPlans();
    const days =
      (Date.now() - cutoffFrom(del).getTime()) / (24 * 60 * 60 * 1000);
    expect(Math.round(days)).toBe(DEFAULT_TRAINING_PLAN_RETENTION_DAYS);
  });

  it('does nothing when another replica holds the run', async () => {
    claim.mockResolvedValue(false);
    await service.sweepExpiredTrainingPlans();
    expect(del).not.toHaveBeenCalled();
  });

  it('records a failure so a broken sweep is visible in the console', async () => {
    del.mockRejectedValue(new Error('connection reset'));
    await service.sweepExpiredTrainingPlans();

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'job',
        jobName: ERROR_LOG_JOB_NAMES.trainingPlanRetention,
      }),
    );
  });

  it('does not rethrow, so one bad night does not kill the scheduler', async () => {
    del.mockRejectedValue(new Error('nope'));
    await expect(service.sweepExpiredTrainingPlans()).resolves.toBeUndefined();
  });
});
