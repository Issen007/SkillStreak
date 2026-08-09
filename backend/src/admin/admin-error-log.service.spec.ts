import { Between, IsNull, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { ErrorLogSource } from '../error-log/entities/error-log-entry.entity';
import {
  AdminErrorLogService,
  buildErrorLogWhere,
} from './admin-error-log.service';

// docs/adr/0022-admin-control-center.md Decision 6's filter set —
// "paginated, filterable by source/status_code range/date". The mapping from
// docs/design/phase7-admin-console-flows.md §5.3's four Status chips onto
// this DTO is the part most likely to silently return the wrong set.
describe('buildErrorLogWhere', () => {
  it('is empty when nothing is filtered', () => {
    expect(buildErrorLogWhere({})).toEqual({});
  });

  it('maps a 5xx chip to an inclusive range', () => {
    expect(
      buildErrorLogWhere({ statusCodeMin: 500, statusCodeMax: 599 }),
    ).toEqual({ statusCode: Between(500, 599) });
  });

  it('supports a half-open range in either direction', () => {
    expect(buildErrorLogWhere({ statusCodeMin: 500 })).toEqual({
      statusCode: MoreThanOrEqual(500),
    });
    expect(buildErrorLogWhere({ statusCodeMax: 499 })).toEqual({
      statusCode: LessThanOrEqual(499),
    });
  });

  // §5.3's "No status" chip is `status_code IS NULL`, i.e. job rows.
  it('maps hasStatusCode=false to IS NULL', () => {
    expect(buildErrorLogWhere({ hasStatusCode: false })).toEqual({
      statusCode: IsNull(),
    });
  });

  // A self-contradictory filter (a NULL status is in no numeric range)
  // resolves to the nullness the operator explicitly asked for, rather than
  // returning an empty set that would read as a console bug.
  it('lets hasStatusCode=false win over an explicit range', () => {
    expect(
      buildErrorLogWhere({
        hasStatusCode: false,
        statusCodeMin: 500,
        statusCodeMax: 599,
      }),
    ).toEqual({ statusCode: IsNull() });
  });

  it('filters by source', () => {
    expect(buildErrorLogWhere({ source: ErrorLogSource.JOB })).toEqual({
      source: ErrorLogSource.JOB,
    });
  });

  it('maps a date window, and each bound on its own', () => {
    const from = '2026-07-08T00:00:00.000Z';
    const to = '2026-08-07T23:59:59.000Z';

    expect(buildErrorLogWhere({ from, to })).toEqual({
      occurredAt: Between(new Date(from), new Date(to)),
    });
    expect(buildErrorLogWhere({ from })).toEqual({
      occurredAt: MoreThanOrEqual(new Date(from)),
    });
    expect(buildErrorLogWhere({ to })).toEqual({
      occurredAt: LessThanOrEqual(new Date(to)),
    });
  });
});

describe('AdminErrorLogService.list', () => {
  function buildService() {
    const errorLogRepository = {
      findAndCount: jest.fn().mockResolvedValue([
        [
          {
            id: '55555555-5555-4555-8555-555555555555',
            occurredAt: new Date('2026-08-07T14:22:00.000Z'),
            source: ErrorLogSource.HTTP,
            route: '/api/v1/consent/:token',
            method: 'GET',
            jobName: null,
            statusCode: 404,
            errorName: 'AppException',
            message: 'Consent token not found or already used',
            stack: 'AppException: ...',
          },
        ],
        231,
      ]),
    };
    const errorLogService = {
      retentionDays: jest.fn().mockReturnValue(45),
      stackMaxFrames: jest.fn().mockReturnValue(12),
    };

    return {
      service: new AdminErrorLogService(
        errorLogRepository as never,
        errorLogService as never,
      ),
      errorLogRepository,
    };
  }

  it('defaults to 50 newest-first rows and reports the unpaged total', async () => {
    const { service, errorLogRepository } = buildService();

    const response = await service.list({});

    expect(errorLogRepository.findAndCount).toHaveBeenCalledWith({
      where: {},
      order: { occurredAt: 'DESC' },
      take: 50,
      skip: 0,
    });
    expect(response.total).toBe(231);
    expect(response.limit).toBe(50);
    expect(response.offset).toBe(0);
  });

  // §13/§2's standing copy rule: the console must interpolate the REAL
  // config values ({retentionDays}/{maxFrames}), never print a literal 90/20
  // that starts lying the day the knob changes. They come from
  // ErrorLogService, which is the same reader the retention sweep and the
  // recorder use, so the console can't be told a different number than the
  // one actually in force.
  it('echoes the live retention/stack-frame config values', async () => {
    const { service } = buildService();

    const response = await service.list({});

    expect(response.retentionDays).toBe(45);
    expect(response.stackMaxFrames).toBe(12);
  });

  // Decision 6: this table has no player_id/team_id column at all, so there
  // is nothing to omit — asserted rather than assumed, since §5.1's whole
  // layout is built on the claim being true.
  it('returns rows that carry no player or team reference', async () => {
    const { service } = buildService();

    const response = await service.list({});

    const serialized = JSON.stringify(response.entries);
    for (const forbidden of [
      'playerId',
      'player_id',
      'teamId',
      'team_id',
      'screenName',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(response.entries[0].route).toBe('/api/v1/consent/:token');
  });
});
