import {
  BugReport,
  BugReportCategory,
  BugReportPlatform,
  BugReportScreen,
  BugReportStatus,
} from '../bug-reports/entities/bug-report.entity';
import { BugReportNotFoundException } from '../common/errors/exceptions';
import { PlayerLocale } from '../common/locale/player-locale.enum';
import { AdminBugReportsService } from './admin-bug-reports.service';

const REPORT_ID = '33333333-3333-4333-8333-333333333333';
const PLAYER_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_ID = '44444444-4444-4444-8444-444444444444';

function buildReport(overrides: Partial<BugReport> = {}): BugReport {
  return {
    id: REPORT_ID,
    playerId: PLAYER_ID,
    category: BugReportCategory.UPLOAD_FAILED,
    description: 'inget hände :(',
    appVersion: '1.4.2',
    platform: BugReportPlatform.IOS,
    osVersion: 'iOS 17.5.1',
    screen: BugReportScreen.CLIP_UPLOAD,
    locale: PlayerLocale.SV,
    status: BugReportStatus.OPEN,
    createdAt: new Date('2026-08-07T14:02:00.000Z'),
    ...overrides,
  };
}

function buildService(options: { reports?: BugReport[] } = {}) {
  const reports = options.reports ?? [buildReport()];
  const updatedStatuses: BugReportStatus[] = [];

  const bugReportRepository = {
    findAndCount: jest.fn().mockResolvedValue([reports, reports.length]),
    findOne: jest.fn().mockImplementation(() =>
      Promise.resolve(
        reports.length > 0
          ? buildReport({
              status: updatedStatuses[updatedStatuses.length - 1],
            })
          : null,
      ),
    ),
    update: jest
      .fn()
      .mockImplementation(
        (_criteria: unknown, patch: { status: BugReportStatus }) => {
          updatedStatuses.push(patch.status);
          return Promise.resolve({ affected: reports.length > 0 ? 1 : 0 });
        },
      ),
    createQueryBuilder: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { status: BugReportStatus.OPEN, count: '7' },
        { status: BugReportStatus.TRIAGED, count: '3' },
      ]),
    }),
  };

  // Note the shape these two return: `find` is called with an explicit
  // `select`, so a real Player row never arrives here with anything beyond
  // id/screenName/teamId. `player_private_info` has no repository at all in
  // this module — there is nothing to stub for it.
  const playerRepository = {
    find: jest
      .fn()
      .mockResolvedValue([
        { id: PLAYER_ID, screenName: 'FloorballStar15', teamId: TEAM_ID },
      ]),
  };
  const teamRepository = {
    find: jest
      .fn()
      .mockResolvedValue([{ id: TEAM_ID, name: 'Lokstallet P13' }]),
  };

  const service = new AdminBugReportsService(
    bugReportRepository as never,
    playerRepository as never,
    teamRepository as never,
  );

  return { service, bugReportRepository, playerRepository, teamRepository };
}

// docs/adr/0022-admin-control-center.md Decision 7 +
// docs/design/phase7-admin-console-flows.md §6.3/§6.4/§13.
describe('AdminBugReportsService.list', () => {
  it('returns screen name + team name and nothing else identifying the reporter', async () => {
    const { service } = buildService();

    const response = await service.list({ limit: 50, offset: 0 });

    expect(response.reports).toHaveLength(1);
    expect(response.reports[0].reporter).toEqual({
      screenName: 'FloorballStar15',
      teamName: 'Lokstallet P13',
    });
    // §6.3/§13: real_name and parent_contact are PlayerPrivateInfo-scoped
    // and have no business on this page — the endpoint must not return them,
    // and `playerId` is withheld too so no drill-down can be built on the
    // response without a visible change here first.
    const serialized = JSON.stringify(response);
    for (const forbidden of [
      'realName',
      'real_name',
      'parentContact',
      'parent_contact',
      'playerId',
      'player_id',
      'birthYear',
      'consentToken',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('reads only three player columns and one team column', async () => {
    const { service, playerRepository, teamRepository } = buildService();

    await service.list({ limit: 50, offset: 0 });

    expect(playerRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, screenName: true, teamId: true },
      }),
    );
    expect(teamRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({ select: { id: true, name: true } }),
    );
  });

  it('orders newest-first with an id tie-break and passes the page window through', async () => {
    const { service, bugReportRepository } = buildService();

    await service.list({
      status: BugReportStatus.OPEN,
      limit: 25,
      offset: 50,
    });

    expect(bugReportRepository.findAndCount).toHaveBeenCalledWith({
      where: { status: BugReportStatus.OPEN },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 25,
      skip: 50,
    });
  });

  // §13: "confirm the list response carries per-status counts, or AD3's
  // chips show no numbers."
  it('carries per-status counts with every status key present, including zeros', async () => {
    const { service } = buildService();

    const response = await service.list({ limit: 50, offset: 0 });

    expect(response.countsByStatus).toEqual({
      open: 7,
      triaged: 3,
      closed: 0,
    });
  });
});

describe('AdminBugReportsService.updateStatus', () => {
  // §6.4/§13: transitions are unrestricted, so the UI need not disable
  // earlier segments. A forward-only guard would send a mis-clicking
  // operator to psql.
  it('accepts a backwards transition (closed → open)', async () => {
    const { service, bugReportRepository } = buildService({
      reports: [buildReport({ status: BugReportStatus.CLOSED })],
    });

    const row = await service.updateStatus(REPORT_ID, BugReportStatus.OPEN);

    expect(bugReportRepository.update).toHaveBeenCalledWith(
      { id: REPORT_ID },
      { status: BugReportStatus.OPEN },
    );
    expect(row.status).toBe(BugReportStatus.OPEN);
  });

  it('accepts triaged → open just the same', async () => {
    const { service } = buildService({
      reports: [buildReport({ status: BugReportStatus.TRIAGED })],
    });

    const row = await service.updateStatus(REPORT_ID, BugReportStatus.OPEN);

    expect(row.status).toBe(BugReportStatus.OPEN);
  });

  // The reporter was erased mid-session (player_id is ON DELETE CASCADE) —
  // §6.4's `gone` state.
  it('throws bug_report_not_found when the row is gone', async () => {
    const { service } = buildService({ reports: [] });

    await expect(
      service.updateStatus(REPORT_ID, BugReportStatus.CLOSED),
    ).rejects.toThrow(BugReportNotFoundException);
  });
});
