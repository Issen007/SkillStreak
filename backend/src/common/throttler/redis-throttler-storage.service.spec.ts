import { RedisThrottlerStorage } from './redis-throttler-storage.service';
import { RedisService } from '../../redis/redis.service';

describe('RedisThrottlerStorage', () => {
  const buildRedisService = (
    responses: Array<{ totalHits: number; ttlMillisecondsRemaining: number }>,
  ) => {
    const throttlerIncrement = jest.fn();
    responses.forEach((response) =>
      throttlerIncrement.mockResolvedValueOnce(response),
    );
    return {
      throttlerIncrement,
      redisService: { throttlerIncrement } as unknown as RedisService,
    };
  };

  it('namespaces the key by throttler name so different throttlers never collide', async () => {
    const { redisService, throttlerIncrement } = buildRedisService([
      { totalHits: 1, ttlMillisecondsRemaining: 60_000 },
    ]);
    const storage = new RedisThrottlerStorage(redisService);

    await storage.increment('1.2.3.4', 60_000, 10, 60_000, 'default');

    expect(throttlerIncrement).toHaveBeenCalledWith(
      'throttler:default:1.2.3.4',
      60_000,
    );
  });

  it('is not blocked while totalHits is within the limit', async () => {
    const { redisService } = buildRedisService([
      { totalHits: 10, ttlMillisecondsRemaining: 45_000 },
    ]);
    const storage = new RedisThrottlerStorage(redisService);

    const record = await storage.increment(
      '1.2.3.4',
      60_000,
      10,
      60_000,
      'default',
    );

    expect(record).toEqual({
      totalHits: 10,
      timeToExpire: 45,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  it('is blocked the instant totalHits exceeds the limit', async () => {
    const { redisService } = buildRedisService([
      { totalHits: 11, ttlMillisecondsRemaining: 30_000 },
    ]);
    const storage = new RedisThrottlerStorage(redisService);

    const record = await storage.increment(
      '1.2.3.4',
      60_000,
      10,
      60_000,
      'default',
    );

    expect(record).toEqual({
      totalHits: 11,
      timeToExpire: 30,
      isBlocked: true,
      timeToBlockExpire: 30,
    });
  });

  it('rounds a sub-second remaining TTL up rather than reporting zero', async () => {
    const { redisService } = buildRedisService([
      { totalHits: 1, ttlMillisecondsRemaining: 250 },
    ]);
    const storage = new RedisThrottlerStorage(redisService);

    const record = await storage.increment(
      '1.2.3.4',
      60_000,
      10,
      60_000,
      'default',
    );

    expect(record.timeToExpire).toBe(1);
  });
});
