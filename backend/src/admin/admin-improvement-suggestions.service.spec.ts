import { ImprovementSuggestionNotFoundException } from '../common/errors/exceptions';
import { PlayerLocale } from '../common/locale/player-locale.enum';
import {
  ImprovementSuggestion,
  ImprovementSuggestionStatus,
} from '../improvement-suggestions/entities/improvement-suggestion.entity';
import { AdminImprovementSuggestionsService } from './admin-improvement-suggestions.service';

const SUGGESTION_ID = '33333333-3333-4333-8333-333333333333';
const PLAYER_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_ID = '44444444-4444-4444-8444-444444444444';

function buildSuggestion(
  overrides: Partial<ImprovementSuggestion> = {},
): ImprovementSuggestion {
  return {
    id: SUGGESTION_ID,
    playerId: PLAYER_ID,
    body: 'man borde kunna välja egen färg på laget',
    appVersion: '1.4.2',
    locale: PlayerLocale.SV,
    status: ImprovementSuggestionStatus.OPEN,
    createdAt: new Date('2026-09-09T09:15:00.000Z'),
    ...overrides,
  };
}

function buildService(
  options: { suggestions?: ImprovementSuggestion[]; affected?: number } = {},
) {
  const suggestions = options.suggestions ?? [buildSuggestion()];
  const updatedStatuses: ImprovementSuggestionStatus[] = [];

  const improvementSuggestionRepository = {
    findAndCount: jest
      .fn()
      .mockResolvedValue([suggestions, suggestions.length]),
    findOne: jest.fn().mockImplementation(() =>
      Promise.resolve(
        suggestions.length > 0
          ? buildSuggestion({
              status: updatedStatuses[updatedStatuses.length - 1],
            })
          : null,
      ),
    ),
    update: jest
      .fn()
      .mockImplementation(
        (
          _criteria: unknown,
          patch: { status: ImprovementSuggestionStatus },
        ) => {
          updatedStatuses.push(patch.status);
          return Promise.resolve({
            affected: options.affected ?? suggestions.length,
          });
        },
      ),
    createQueryBuilder: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      // pg hands back bigint counts as strings — the service must parse
      // them rather than coerce implicitly.
      getRawMany: jest.fn().mockResolvedValue([{ status: 'open', count: '4' }]),
    })),
  };

  const playerRepository = {
    find: jest
      .fn()
      .mockResolvedValue([
        { id: PLAYER_ID, screenName: 'FloorballStar15', teamId: TEAM_ID },
      ]),
  };
  const teamRepository = {
    find: jest.fn().mockResolvedValue([{ id: TEAM_ID, name: 'Ackers P13' }]),
  };

  const service = new AdminImprovementSuggestionsService(
    improvementSuggestionRepository as never,
    playerRepository as never,
    teamRepository as never,
  );

  return {
    service,
    improvementSuggestionRepository,
    playerRepository,
    teamRepository,
  };
}

describe('AdminImprovementSuggestionsService.list', () => {
  it('returns the suggestion with its author’s screen name and team name', async () => {
    const { service } = buildService();

    const response = await service.list({ limit: 50, offset: 0 });

    expect(response.suggestions).toEqual([
      {
        id: SUGGESTION_ID,
        createdAt: '2026-09-09T09:15:00.000Z',
        status: ImprovementSuggestionStatus.OPEN,
        body: 'man borde kunna välja egen färg på laget',
        appVersion: '1.4.2',
        locale: PlayerLocale.SV,
        author: { screenName: 'FloorballStar15', teamName: 'Ackers P13' },
      },
    ]);
  });

  /**
   * A security property, not a formatting detail: the console can build no
   * per-child view out of a response that never carries the id, and
   * ADR-0022 Decision 5's named anti-pattern is exactly such a view
   * arriving through a table like this one.
   */
  it('puts no playerId on the wire', async () => {
    const { service } = buildService();

    const response = await service.list({ limit: 50, offset: 0 });

    expect(JSON.stringify(response)).not.toContain(PLAYER_ID);
  });

  // real_name / parent_contact live in the isolated, encrypted
  // player_private_info table. This service is not given a repository for
  // it, and asks Player for exactly three columns.
  it('reads exactly three player columns and never player_private_info', async () => {
    const { service, playerRepository } = buildService();

    await service.list({ limit: 50, offset: 0 });

    const [[query]] = playerRepository.find.mock.calls as [
      [{ select: Record<string, boolean> }],
    ];
    expect(Object.keys(query.select).sort()).toEqual([
      'id',
      'screenName',
      'teamId',
    ]);
  });

  it('degrades to a null author when the writer’s row is gone', async () => {
    const { service, playerRepository } = buildService();
    playerRepository.find.mockResolvedValue([]);

    const response = await service.list({ limit: 50, offset: 0 });

    expect(response.suggestions[0].author).toBeNull();
  });

  it('always reports every status, including the zeros', async () => {
    const { service } = buildService();

    const response = await service.list({ limit: 50, offset: 0 });

    expect(response.countsByStatus).toEqual({ open: 4, triaged: 0, closed: 0 });
  });

  it('orders newest first with an id tie-break, so pages cannot drop rows', async () => {
    const { service, improvementSuggestionRepository } = buildService();

    await service.list({ limit: 50, offset: 0 });

    const [[options]] = improvementSuggestionRepository.findAndCount.mock
      .calls as [[{ order: Record<string, string> }]];
    expect(options.order).toEqual({ createdAt: 'DESC', id: 'DESC' });
  });
});

describe('AdminImprovementSuggestionsService.updateStatus', () => {
  it('accepts a backwards transition — closed back to open', async () => {
    const { service } = buildService();

    const row = await service.updateStatus(
      SUGGESTION_ID,
      ImprovementSuggestionStatus.OPEN,
    );

    expect(row.status).toBe(ImprovementSuggestionStatus.OPEN);
  });

  // A designed-for case: an account erasure cascades the row away while
  // the operator still has it open.
  it('throws not-found when the row is already gone', async () => {
    const { service } = buildService({ suggestions: [], affected: 0 });

    await expect(
      service.updateStatus(SUGGESTION_ID, ImprovementSuggestionStatus.TRIAGED),
    ).rejects.toBeInstanceOf(ImprovementSuggestionNotFoundException);
  });
});
