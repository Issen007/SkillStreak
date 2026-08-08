import { BugReportRateLimitedException } from '../common/errors/exceptions';
import { PlayerLocale } from '../common/locale/player-locale.enum';
import { BugReportsService } from './bug-reports.service';
import { CreateBugReportDto } from './dto/create-bug-report.dto';
import {
  BugReportCategory,
  BugReportPlatform,
  BugReportScreen,
  BugReportStatus,
} from './entities/bug-report.entity';

const PLAYER_ID = '11111111-1111-4111-8111-111111111111';

function buildDto(overrides: Partial<CreateBugReportDto> = {}) {
  return {
    category: BugReportCategory.UPLOAD_FAILED,
    screen: BugReportScreen.CLIP_UPLOAD,
    description: 'jag tryckte på ladda upp och sen bara snurra snurra',
    appVersion: '1.4.2',
    platform: BugReportPlatform.IOS,
    osVersion: 'iOS 17.5.1',
    locale: PlayerLocale.SV,
    ...overrides,
  } as CreateBugReportDto;
}

function buildService(
  redisOverrides: {
    cooldown?: boolean;
    dailyCap?: boolean;
  } = {},
) {
  const bugReportRepository = {
    create: jest.fn((row: Record<string, unknown>) => row),
    save: jest.fn((row: Record<string, unknown>) =>
      Promise.resolve({
        ...row,
        id: '22222222-2222-4222-8222-222222222222',
        createdAt: new Date('2026-08-07T14:02:00.000Z'),
      }),
    ),
  };
  const redisService = {
    tryClaimBugReportCooldown: jest
      .fn()
      .mockResolvedValue(redisOverrides.cooldown ?? true),
    tryClaimBugReportDailyCap: jest
      .fn()
      .mockResolvedValue(redisOverrides.dailyCap ?? true),
  };

  const service = new BugReportsService(
    bugReportRepository as never,
    redisService as never,
  );

  return { service, bugReportRepository, redisService };
}

// docs/adr/0022-admin-control-center.md Decision 7's submission endpoint.
describe('BugReportsService.submit', () => {
  it('persists exactly the allow-listed fields, with status open and the session’s playerId', async () => {
    const { service, bugReportRepository } = buildService();

    const result = await service.submit(PLAYER_ID, buildDto());

    expect(bugReportRepository.create).toHaveBeenCalledWith({
      playerId: PLAYER_ID,
      category: BugReportCategory.UPLOAD_FAILED,
      screen: BugReportScreen.CLIP_UPLOAD,
      description: 'jag tryckte på ladda upp och sen bara snurra snurra',
      appVersion: '1.4.2',
      platform: BugReportPlatform.IOS,
      osVersion: 'iOS 17.5.1',
      locale: PlayerLocale.SV,
      status: BugReportStatus.OPEN,
    });
    expect(result).toEqual({
      id: '22222222-2222-4222-8222-222222222222',
      createdAt: '2026-08-07T14:02:00.000Z',
    });
  });

  it('writes explicit nulls for an omitted description/osVersion', async () => {
    const { service, bugReportRepository } = buildService();

    await service.submit(
      PLAYER_ID,
      buildDto({ description: undefined, osVersion: undefined }),
    );

    expect(bugReportRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ description: null, osVersion: null }),
    );
  });

  // The rate limit, per Decision 7 ("rate-limited... e.g. a per-player daily
  // cap") and docs/design/phase7-admin-console-flows.md §13's naming
  // instruction — `bug_report_rate_limited`, mirroring
  // `erasure_rate_limited`'s existing shape.
  it('throws bug_report_rate_limited on a burst-cooldown failure, before touching the DB', async () => {
    const { service, bugReportRepository, redisService } = buildService({
      cooldown: false,
    });

    await expect(service.submit(PLAYER_ID, buildDto())).rejects.toThrow(
      BugReportRateLimitedException,
    );
    expect(bugReportRepository.save).not.toHaveBeenCalled();
    // The daily counter must not be consumed by a request the burst lock
    // already refused — otherwise a rapid-fire client would burn the whole
    // day's allowance without a single report being stored.
    expect(redisService.tryClaimBugReportDailyCap).not.toHaveBeenCalled();
  });

  it('throws bug_report_rate_limited once the daily cap is exhausted', async () => {
    const { service, bugReportRepository } = buildService({ dailyCap: false });

    await expect(service.submit(PLAYER_ID, buildDto())).rejects.toThrow(
      BugReportRateLimitedException,
    );
    expect(bugReportRepository.save).not.toHaveBeenCalled();
  });

  it('exposes the rate limit as code bug_report_rate_limited / 429', () => {
    const exception = new BugReportRateLimitedException();

    expect(exception.code).toBe('bug_report_rate_limited');
    expect(exception.getStatus()).toBe(429);
  });

  // §9.1 / BugReportsService's own docstring: this endpoint is deliberately
  // NOT consent-gated, because a pending-consent child is the person most
  // likely to need to report something. Pinned as a test so a future
  // "hardening" pass that adds assertConsentApproved fails loudly instead of
  // silently silencing that cohort.
  it('accepts a submission without consulting parental-consent status at all', async () => {
    const { service, bugReportRepository } = buildService();

    await service.submit(PLAYER_ID, buildDto());

    // The service holds no players/consent dependency to consult — a
    // consent gate would have to add one, which is the change this test
    // exists to make visible.
    expect(BugReportsService.length).toBe(2);
    expect(bugReportRepository.save).toHaveBeenCalledTimes(1);
  });
});
