import { ImprovementSuggestionRateLimitedException } from '../common/errors/exceptions';
import { PlayerLocale } from '../common/locale/player-locale.enum';
import { CreateImprovementSuggestionDto } from './dto/create-improvement-suggestion.dto';
import { ImprovementSuggestionStatus } from './entities/improvement-suggestion.entity';
import { ImprovementSuggestionsService } from './improvement-suggestions.service';

const PLAYER_ID = '11111111-1111-4111-8111-111111111111';

function buildDto(
  overrides: Partial<CreateImprovementSuggestionDto> = {},
): CreateImprovementSuggestionDto {
  return {
    body: 'ni borde ha en knapp för att träna med kompis',
    appVersion: '1.4.2',
    locale: PlayerLocale.SV,
    ...overrides,
  };
}

function buildService(
  redisOverrides: { cooldown?: boolean; dailyCap?: boolean } = {},
) {
  const improvementSuggestionRepository = {
    create: jest.fn((row: Record<string, unknown>) => row),
    save: jest.fn((row: Record<string, unknown>) =>
      Promise.resolve({
        ...row,
        id: '22222222-2222-4222-8222-222222222222',
        createdAt: new Date('2026-09-09T09:15:00.000Z'),
      }),
    ),
  };
  const redisService = {
    tryClaimImprovementSuggestionCooldown: jest
      .fn()
      .mockResolvedValue(redisOverrides.cooldown ?? true),
    tryClaimImprovementSuggestionDailyCap: jest
      .fn()
      .mockResolvedValue(redisOverrides.dailyCap ?? true),
  };

  const service = new ImprovementSuggestionsService(
    improvementSuggestionRepository as never,
    redisService as never,
  );

  return { service, improvementSuggestionRepository, redisService };
}

// docs/adr/0037-in-app-improvement-suggestions.md's submission endpoint.
describe('ImprovementSuggestionsService.submit', () => {
  it('persists exactly the allow-listed fields, with status open and the session’s playerId', async () => {
    const { service, improvementSuggestionRepository } = buildService();

    const result = await service.submit(PLAYER_ID, buildDto());

    expect(improvementSuggestionRepository.create).toHaveBeenCalledWith({
      playerId: PLAYER_ID,
      body: 'ni borde ha en knapp för att träna med kompis',
      appVersion: '1.4.2',
      locale: PlayerLocale.SV,
      status: ImprovementSuggestionStatus.OPEN,
    });
    expect(result).toEqual({
      id: '22222222-2222-4222-8222-222222222222',
      createdAt: '2026-09-09T09:15:00.000Z',
    });
  });

  // The capture allow-list, asserted as an absence rather than trusted to
  // the entity: no platform, no OS version, no device id, no location, and
  // nothing a caller could smuggle in past the DTO.
  it('writes no field beyond the five above', async () => {
    const { service, improvementSuggestionRepository } = buildService();

    await service.submit(PLAYER_ID, buildDto());

    const [row] = improvementSuggestionRepository.create.mock.calls[0];
    expect(Object.keys(row).sort()).toEqual([
      'appVersion',
      'body',
      'locale',
      'playerId',
      'status',
    ]);
  });

  // A client cannot file something already triaged or closed, whatever it
  // puts in the body — the DTO has no status field, and the service pins it.
  it('ignores a status supplied by the client', async () => {
    const { service, improvementSuggestionRepository } = buildService();

    await service.submit(
      PLAYER_ID,
      buildDto({
        status: ImprovementSuggestionStatus.CLOSED,
      } as Partial<CreateImprovementSuggestionDto>),
    );

    expect(improvementSuggestionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: ImprovementSuggestionStatus.OPEN }),
    );
  });

  it('refuses and never touches Postgres when the burst cooldown is held', async () => {
    const { service, improvementSuggestionRepository } = buildService({
      cooldown: false,
    });

    await expect(service.submit(PLAYER_ID, buildDto())).rejects.toBeInstanceOf(
      ImprovementSuggestionRateLimitedException,
    );
    expect(improvementSuggestionRepository.save).not.toHaveBeenCalled();
  });

  it('refuses and never touches Postgres when the daily cap is spent', async () => {
    const { service, improvementSuggestionRepository } = buildService({
      dailyCap: false,
    });

    await expect(service.submit(PLAYER_ID, buildDto())).rejects.toBeInstanceOf(
      ImprovementSuggestionRateLimitedException,
    );
    expect(improvementSuggestionRepository.save).not.toHaveBeenCalled();
  });

  // Consent is deliberately not checked here (see the service's docstring
  // and the project owner's 2026-09-09 decision). This asserts the
  // *absence* on purpose: the service takes no player repository at all, so
  // there is nothing for a future "quick fix" to gate on without a
  // deliberate signature change.
  it('submits without reading any player row, consent status included', async () => {
    const { service } = buildService();

    // The service is constructed with a suggestion repository and Redis,
    // and nothing else — there is no player repository here for a future
    // "quick fix" to gate on without a deliberate signature change.
    await expect(service.submit(PLAYER_ID, buildDto())).resolves.toEqual(
      expect.objectContaining({ id: expect.any(String) as string }),
    );
  });
});
