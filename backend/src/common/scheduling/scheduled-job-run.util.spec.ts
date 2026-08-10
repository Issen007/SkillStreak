import { Logger } from '@nestjs/common';
import {
  SCHEDULED_JOB_LOCK_TTL_SECONDS,
  tryClaimScheduledJobRunOrSkip,
} from './scheduled-job-run.util';

/**
 * Every scheduled job in the app now routes its run-claim through this one
 * function, so a regression here would silently affect all six at once —
 * either letting both replicas run the same DELETE, or stopping every job
 * from ever running. The per-service specs still cover the behaviour end
 * to end; these cover the shared piece directly.
 */
describe('tryClaimScheduledJobRunOrSkip', () => {
  // Returned alongside the Logger so assertions never reference an
  // unbound method off the cast object.
  function buildLogger() {
    const debug = jest.fn();
    const warn = jest.fn();
    return { logger: { debug, warn } as unknown as Logger, debug, warn };
  }

  it('claims the run and reports success', async () => {
    const redisService = {
      tryClaimScheduledJobRun: jest.fn().mockResolvedValue(true),
    };

    await expect(
      tryClaimScheduledJobRunOrSkip(
        redisService as never,
        buildLogger().logger,
        'a-job',
      ),
    ).resolves.toBe(true);
  });

  it('defaults to the shared five-minute lock TTL', async () => {
    const redisService = {
      tryClaimScheduledJobRun: jest.fn().mockResolvedValue(true),
    };

    await tryClaimScheduledJobRunOrSkip(
      redisService as never,
      buildLogger().logger,
      'a-job',
    );

    expect(redisService.tryClaimScheduledJobRun).toHaveBeenCalledWith(
      'a-job',
      SCHEDULED_JOB_LOCK_TTL_SECONDS,
    );
    expect(SCHEDULED_JOB_LOCK_TTL_SECONDS).toBe(300);
  });

  it('declines when another replica already holds the claim', async () => {
    const redisService = {
      tryClaimScheduledJobRun: jest.fn().mockResolvedValue(false),
    };

    await expect(
      tryClaimScheduledJobRunOrSkip(
        redisService as never,
        buildLogger().logger,
        'a-job',
      ),
    ).resolves.toBe(false);
  });

  it('declines rather than throwing when Redis is unreachable', async () => {
    const redisService = {
      tryClaimScheduledJobRun: jest
        .fn()
        .mockRejectedValue(new Error('redis down')),
    };

    // This is the property that matters most: an unreachable Redis must
    // never propagate out of a @Cron handler as an unhandled rejection,
    // and must never be treated as "nobody else has it, go ahead".
    await expect(
      tryClaimScheduledJobRunOrSkip(
        redisService as never,
        buildLogger().logger,
        'a-job',
      ),
    ).resolves.toBe(false);
  });

  it('logs through the caller-supplied logger, not its own', async () => {
    const { logger, debug } = buildLogger();
    const redisService = {
      tryClaimScheduledJobRun: jest.fn().mockResolvedValue(false),
    };

    await tryClaimScheduledJobRunOrSkip(redisService as never, logger, 'a-job');

    // Skip lines have to keep naming the service they came from — six jobs
    // all logging as this utility would make an operator's log useless.
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('a-job'));
  });

  it('survives a non-Error rejection', async () => {
    const { logger, warn } = buildLogger();
    const redisService = {
      tryClaimScheduledJobRun: jest.fn().mockRejectedValue('a bare string'),
    };

    await expect(
      tryClaimScheduledJobRunOrSkip(redisService as never, logger, 'a-job'),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('a bare string'));
  });
});
