import { RedisService } from './redis.service';

function buildService(overrides: { setResult?: string | null } = {}) {
  const setResult = 'setResult' in overrides ? overrides.setResult : 'OK';
  const client = {
    set: jest.fn().mockResolvedValue(setResult),
  };
  const service = new RedisService(client as never);
  return { service, client };
}

// k8s/README.md's now-resolved "Scheduled-job races" note —
// tryClaimScheduledJobRun is the non-blocking try-lock the three `@Cron`
// handlers (ClipRetentionService's two sweeps,
// AccountErasureSweepService's sweep) use so only one api replica actually
// runs a given tick.
describe('RedisService.tryClaimScheduledJobRun', () => {
  it('claims the job with SET key value EX ttlSeconds NX and returns true when it wins', async () => {
    const { service, client } = buildService();

    const claimed = await service.tryClaimScheduledJobRun(
      'clip-retention:published',
      300,
    );

    expect(claimed).toBe(true);
    expect(client.set).toHaveBeenCalledWith(
      'scheduled-job-run:clip-retention:published',
      '1',
      'EX',
      300,
      'NX',
    );
  });

  it('returns false when another replica already claimed this tick (SET NX no-op)', async () => {
    const { service } = buildService({ setResult: null });

    const claimed = await service.tryClaimScheduledJobRun(
      'account-erasure:sweep',
      300,
    );

    expect(claimed).toBe(false);
  });

  it('namespaces the lock key by job name so different jobs never collide', async () => {
    const { service, client } = buildService();

    await service.tryClaimScheduledJobRun('clip-retention:pending-upload', 300);

    expect(client.set).toHaveBeenCalledWith(
      'scheduled-job-run:clip-retention:pending-upload',
      '1',
      'EX',
      300,
      'NX',
    );
  });
});
