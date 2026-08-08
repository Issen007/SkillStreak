import {
  ErrorLogEntry,
  ErrorLogSource,
} from './entities/error-log-entry.entity';
import { ErrorLogService } from './error-log.service';

function buildService(config: Record<string, string> = {}) {
  const errorLogRepository = {
    insert: jest.fn().mockResolvedValue(undefined),
  };
  const configService = {
    get: jest.fn((key: string) => config[key]),
  };

  const service = new ErrorLogService(
    errorLogRepository as never,
    configService as never,
  );

  return { service, errorLogRepository };
}

function insertedRow(errorLogRepository: {
  insert: jest.Mock;
}): Partial<ErrorLogEntry> {
  const [[row]] = errorLogRepository.insert.mock.calls as [
    [Partial<ErrorLogEntry>],
  ];
  return row;
}

// docs/adr/0022-admin-control-center.md Decision 6 — the recorder itself.
describe('ErrorLogService.record', () => {
  it('writes an http row with route/method/status and no job name', async () => {
    const { service, errorLogRepository } = buildService();

    await service.record({
      source: 'http',
      route: '/api/v1/consent/:token',
      method: 'GET',
      statusCode: 404,
      error: new Error('Consent token not found or already used'),
    });

    expect(insertedRow(errorLogRepository)).toMatchObject({
      source: ErrorLogSource.HTTP,
      route: '/api/v1/consent/:token',
      method: 'GET',
      statusCode: 404,
      jobName: null,
      errorName: 'Error',
      message: 'Consent token not found or already used',
    });
  });

  it('writes a job row with no route/method/status', async () => {
    const { service, errorLogRepository } = buildService();

    await service.record({
      source: 'job',
      jobName: 'clip-retention:published',
      error: new Error('connection terminated unexpectedly'),
    });

    expect(insertedRow(errorLogRepository)).toMatchObject({
      source: ErrorLogSource.JOB,
      jobName: 'clip-retention:published',
      route: null,
      method: null,
      statusCode: null,
    });
  });

  // Decision 6's structural exclusion, asserted rather than assumed: there
  // is no player/team column on this table at all, and nothing the recorder
  // writes may resemble one.
  it('never writes a player or team reference', async () => {
    const { service, errorLogRepository } = buildService();

    await service.record({
      source: 'http',
      route: '/api/v1/teams/:teamId/clips',
      method: 'POST',
      statusCode: 500,
      error: new Error('boom'),
    });

    const row = insertedRow(errorLogRepository) as Record<string, unknown>;
    expect(Object.keys(row)).toEqual(
      expect.not.arrayContaining([
        'playerId',
        'teamId',
        'player_id',
        'team_id',
      ]),
    );
  });

  it('truncates the message to the varchar(500) column width', async () => {
    const { service, errorLogRepository } = buildService();

    await service.record({
      source: 'job',
      jobName: 'usage-metrics:report',
      error: new Error('x'.repeat(900)),
    });

    expect(insertedRow(errorLogRepository).message).toHaveLength(500);
  });

  it('keeps only the configured number of stack frames', async () => {
    const { service, errorLogRepository } = buildService({
      ERROR_LOG_STACK_MAX_FRAMES: '3',
    });
    const error = new Error('deep');
    error.stack = [
      'Error: deep',
      ...Array.from({ length: 40 }, (_, i) => `    at frame${i} (a.ts:${i}:1)`),
    ].join('\n');

    await service.record({
      source: 'job',
      jobName: 'usage-metrics:report',
      error,
    });

    const stack = insertedRow(errorLogRepository).stack ?? '';
    expect(stack.split('\n')).toEqual([
      'Error: deep',
      '    at frame0 (a.ts:0:1)',
      '    at frame1 (a.ts:1:1)',
      '    at frame2 (a.ts:2:1)',
    ]);
  });

  it('records a non-Error throw rather than crashing on it', async () => {
    const { service, errorLogRepository } = buildService();

    await service.record({
      source: 'job',
      jobName: 'error-log:retention',
      error: 'a bare string throw',
    });

    expect(insertedRow(errorLogRepository)).toMatchObject({
      errorName: 'NonError',
      message: 'a bare string throw',
      stack: null,
    });
  });

  // Applied only to the unmatched-route case (route === null), where the
  // whole message is the resolved URL — a near-miss on a token-bearing
  // route would otherwise persist a live consent/erasure token here.
  it('redacts the resolved path from an unmatched-route 404 message', async () => {
    const { service, errorLogRepository } = buildService();

    await service.record({
      source: 'http',
      route: null,
      method: 'GET',
      statusCode: 404,
      error: new Error('Cannot GET /api/v1/consent/live-secret-token/x'),
    });

    expect(insertedRow(errorLogRepository).message).toBe(
      'Cannot GET (unmatched path redacted)',
    );
  });

  it("leaves a matched route's message untouched", async () => {
    const { service, errorLogRepository } = buildService();

    await service.record({
      source: 'http',
      route: '/api/v1/consent/:token',
      method: 'GET',
      statusCode: 404,
      error: new Error('Cannot GET /api/v1/consent/live-secret-token'),
    });

    expect(insertedRow(errorLogRepository).message).toBe(
      'Cannot GET /api/v1/consent/live-secret-token',
    );
  });

  // The load-bearing property of the whole class: an error while recording
  // an error must never become a second error. The exception filter calls
  // this without awaiting it, so a rejection here would surface as an
  // unhandled rejection on a response already in flight.
  it('swallows a repository failure instead of propagating it', async () => {
    const { service, errorLogRepository } = buildService();
    errorLogRepository.insert.mockRejectedValue(
      new Error('relation "error_log_entry" does not exist'),
    );

    await expect(
      service.record({
        source: 'http',
        route: null,
        method: 'GET',
        statusCode: 500,
        error: new Error('original failure'),
      }),
    ).resolves.toBeUndefined();
  });
});

// Both knobs are echoed by the admin API so the console can interpolate the
// real numbers instead of hardcoding 90/20 (docs/design/
// phase7-admin-console-flows.md §5.2/§13) — which only works if a bad value
// resolves to the default rather than to NaN.
describe('ErrorLogService config knobs', () => {
  it('defaults to 90 days / 20 frames when unset', () => {
    const { service } = buildService();

    expect(service.retentionDays()).toBe(90);
    expect(service.stackMaxFrames()).toBe(20);
  });

  it('reads overrides from config', () => {
    const { service } = buildService({
      ERROR_LOG_RETENTION_DAYS: '30',
      ERROR_LOG_STACK_MAX_FRAMES: '5',
    });

    expect(service.retentionDays()).toBe(30);
    expect(service.stackMaxFrames()).toBe(5);
  });

  // The repeatedly-hit empty-string-env-var case (see env.validation.ts's
  // own comments): '' is a PRESENT value, not an absent one.
  it('falls back to the defaults for empty, non-numeric or non-positive values', () => {
    for (const bad of ['', '   ', 'ninety', '0', '-5', '2.5']) {
      const { service } = buildService({
        ERROR_LOG_RETENTION_DAYS: bad,
        ERROR_LOG_STACK_MAX_FRAMES: bad,
      });
      expect(service.retentionDays()).toBe(90);
      expect(service.stackMaxFrames()).toBe(20);
    }
  });
});
