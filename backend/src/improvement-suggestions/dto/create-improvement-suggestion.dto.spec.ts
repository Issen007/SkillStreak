// Loaded explicitly because this spec's import graph is unusually small:
// it reaches neither typeorm nor @nestjs/common, which is what pulls
// reflect-metadata in for every other DTO spec here. Production always has
// it — main.ts imports it first thing.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import {
  IMPROVEMENT_SUGGESTION_BODY_MAX_LENGTH,
  IMPROVEMENT_SUGGESTION_VERSION_STRING_MAX_LENGTH,
} from '../improvement-suggestions.constants';
import { CreateImprovementSuggestionDto } from './create-improvement-suggestion.dto';

// Same whitelist/forbidNonWhitelisted settings main.ts's global
// ValidationPipe runs with — this is the real boundary behaviour, not a
// looser approximation of it.
async function validateDto(
  plain: Record<string, unknown>,
): Promise<ValidationError[]> {
  const instance = plainToInstance(CreateImprovementSuggestionDto, plain, {
    enableImplicitConversion: true,
  });
  return validate(instance, { whitelist: true, forbidNonWhitelisted: true });
}

function validPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    body: 'gör så att man kan välja egen färg på laget',
    appVersion: '1.4.2',
    locale: 'sv',
    ...overrides,
  };
}

function errorFields(errors: ValidationError[]): string[] {
  return errors.map((error) => error.property).sort();
}

describe('CreateImprovementSuggestionDto', () => {
  it('accepts a well-formed payload', async () => {
    expect(await validateDto(validPayload())).toEqual([]);
  });

  it('trims the body before it is stored', () => {
    const instance = plainToInstance(CreateImprovementSuggestionDto, {
      ...validPayload(),
      body: '  fler badges  ',
    });
    expect(instance.body).toBe('fler badges');
  });

  // The whole reason the trim runs before @MinLength rather than after:
  // "   " must be a 400, not a blank row in the operator's queue.
  it.each(['', '   ', '\n\t '])('rejects a body of %j', async (body) => {
    expect(errorFields(await validateDto(validPayload({ body })))).toEqual([
      'body',
    ]);
  });

  it('rejects a missing body — unlike a bug report, there is no picker to fall back on', async () => {
    const plain = validPayload();
    delete plain.body;
    expect(errorFields(await validateDto(plain))).toEqual(['body']);
  });

  it('rejects a body past the column width', async () => {
    const body = 'a'.repeat(IMPROVEMENT_SUGGESTION_BODY_MAX_LENGTH + 1);
    expect(errorFields(await validateDto(validPayload({ body })))).toEqual([
      'body',
    ]);
  });

  it('accepts a body exactly at the column width', async () => {
    const body = 'a'.repeat(IMPROVEMENT_SUGGESTION_BODY_MAX_LENGTH);
    expect(await validateDto(validPayload({ body }))).toEqual([]);
  });

  // appVersion is as attacker-controllable as the body, and an unbounded
  // column plus an unbounded DTO is megabytes per row in a paginated table.
  it('rejects an oversized appVersion', async () => {
    const appVersion = 'v'.repeat(
      IMPROVEMENT_SUGGESTION_VERSION_STRING_MAX_LENGTH + 1,
    );
    expect(
      errorFields(await validateDto(validPayload({ appVersion }))),
    ).toEqual(['appVersion']);
  });

  it('rejects a locale outside ADR-0014’s eight', async () => {
    expect(
      errorFields(await validateDto(validPayload({ locale: 'is' }))),
    ).toEqual(['locale']);
  });

  // The capture allow-list at the boundary: anything not declared on the
  // DTO is a 400, never a silently-dropped field.
  it.each([
    ['playerId', '11111111-1111-4111-8111-111111111111'],
    ['latitude', 59.33],
    ['deviceId', 'ABCD-1234'],
    ['status', 'closed'],
  ])('rejects an undeclared %s field', async (field, value) => {
    const errors = await validateDto(validPayload({ [field]: value }));
    expect(errorFields(errors)).toEqual([field]);
  });
});
