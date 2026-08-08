import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { PlayerLocale } from '../../common/locale/player-locale.enum';
import {
  BUG_REPORT_DESCRIPTION_MAX_LENGTH,
  BUG_REPORT_VERSION_STRING_MAX_LENGTH,
} from '../bug-reports.constants';
import { CreateBugReportDto } from './create-bug-report.dto';

// Same whitelist/forbidNonWhitelisted settings main.ts's global
// ValidationPipe runs with — this is the real boundary behaviour, not a
// looser approximation of it.
async function validateDto(
  plain: Record<string, unknown>,
): Promise<ValidationError[]> {
  const instance = plainToInstance(CreateBugReportDto, plain, {
    enableImplicitConversion: true,
  });
  return validate(instance, { whitelist: true, forbidNonWhitelisted: true });
}

function validPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    category: 'upload_failed',
    screen: 'clip_upload',
    description: 'inget hände',
    appVersion: '1.4.2',
    platform: 'ios',
    osVersion: 'iOS 17.5.1',
    locale: 'sv',
    ...overrides,
  };
}

function errorFields(errors: ValidationError[]): string[] {
  return errors.map((error) => error.property).sort();
}

// docs/adr/0022-admin-control-center.md Decision 7's capture allow-list at
// the boundary — including the 2026-08-02 security-reviewer correction that
// every enum field must actually be constrained, "never an unconstrained
// string".
describe('CreateBugReportDto', () => {
  it('accepts a complete, valid submission', async () => {
    expect(await validateDto(validPayload())).toEqual([]);
  });

  it('accepts a submission with no description and no osVersion', async () => {
    expect(
      await validateDto(
        validPayload({ description: undefined, osVersion: undefined }),
      ),
    ).toEqual([]);
  });

  it.each([
    ['category', 'not_a_category'],
    ['screen', 'roster'],
    ['platform', 'windows'],
    ['locale', 'pl'],
  ])('rejects an out-of-vocabulary %s', async (field, value) => {
    const errors = await validateDto(validPayload({ [field]: value }));

    expect(errorFields(errors)).toEqual([field]);
  });

  // `roster` above is the specific one worth naming: it appears in Decision
  // 7's own illustrative list but was deliberately folded into `team` by
  // docs/design/phase7-admin-console-flows.md §9.3, so a client sending it
  // must be rejected rather than silently stored.
  it('accepts all 10 §9.3 screen values, in the picker’s own order', async () => {
    const screens = [
      'home',
      'chat',
      'clips',
      'clip_upload',
      'goal',
      'team',
      'leaderboard',
      'profile',
      'onboarding',
      'other',
    ];

    for (const screen of screens) {
      expect(await validateDto(validPayload({ screen }))).toEqual([]);
    }
  });

  it.each(['category', 'screen', 'platform', 'locale', 'appVersion'])(
    'requires %s',
    async (field) => {
      const payload = validPayload();
      delete payload[field];

      expect(errorFields(await validateDto(payload))).toEqual([field]);
    },
  );

  it('rejects a description past the 500-char column width', async () => {
    const errors = await validateDto(
      validPayload({
        description: 'x'.repeat(BUG_REPORT_DESCRIPTION_MAX_LENGTH + 1),
      }),
    );

    expect(errorFields(errors)).toEqual(['description']);
  });

  // The 2026-08-02 correction's actual point: app_version/os_version are
  // just as attacker-controllable as description, and the original draft
  // treated them as if they weren't.
  it.each(['appVersion', 'osVersion'])('caps %s', async (field) => {
    const errors = await validateDto(
      validPayload({
        [field]: 'x'.repeat(BUG_REPORT_VERSION_STRING_MAX_LENGTH + 1),
      }),
    );

    expect(errorFields(errors)).toEqual([field]);
  });

  it('trims a whitespace-only description to "no description" rather than failing', async () => {
    const instance = plainToInstance(
      CreateBugReportDto,
      validPayload({ description: '   \n  ' }),
    );

    expect(await validate(instance)).toEqual([]);
    expect(instance.description).toBeUndefined();
  });

  // CLAUDE.md's non-negotiable constraint, enforced structurally: there is
  // no location field, so forbidNonWhitelisted rejects any attempt to add
  // one on the wire rather than silently dropping it.
  it.each([
    ['latitude', 59.33],
    ['location', 'Stockholm'],
    ['deviceId', 'ABCD-1234'],
    ['playerId', '11111111-1111-4111-8111-111111111111'],
    ['status', 'closed'],
  ])('rejects an unlisted %s field outright', async (field, value) => {
    const errors = await validateDto(validPayload({ [field]: value }));

    expect(errorFields(errors)).toEqual([field]);
  });

  it('accepts every ADR-0014 locale', async () => {
    for (const locale of Object.values(PlayerLocale)) {
      expect(await validateDto(validPayload({ locale }))).toEqual([]);
    }
  });
});
