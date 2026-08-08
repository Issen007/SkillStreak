import { StaffUnauthorizedException } from '../common/errors/exceptions';
import { AdminSessionService } from './admin-session.service';

const STAFF_ACCOUNT_ID = '66666666-6666-4666-8666-666666666666';

function buildService(options: {
  account?: Record<string, unknown> | null;
  appPublicUrl?: string;
}) {
  const staffAccountRepository = {
    findOne: jest.fn().mockResolvedValue(
      options.account === undefined
        ? {
            id: STAFF_ACCOUNT_ID,
            displayName: 'Christian Petersson',
            lastLoginAt: new Date('2026-08-07T05:40:00.000Z'),
          }
        : options.account,
    ),
  };
  const configService = {
    get: jest.fn().mockReturnValue(options.appPublicUrl),
  };

  return {
    service: new AdminSessionService(
      staffAccountRepository as never,
      configService as never,
    ),
  };
}

// docs/design/phase7-admin-console-flows.md §13's session endpoint.
describe('AdminSessionService.describe', () => {
  it('returns the operator’s display name, login time and environment', async () => {
    const { service } = buildService({
      appPublicUrl: 'https://api.skillstreak.xyz',
    });

    await expect(service.describe(STAFF_ACCOUNT_ID)).resolves.toEqual({
      displayName: 'Christian Petersson',
      authenticatedAt: '2026-08-07T05:40:00.000Z',
      environment: 'production',
    });
  });

  it('falls back to a generic name when the provider gave none (Apple after first login)', async () => {
    const { service } = buildService({
      account: {
        id: STAFF_ACCOUNT_ID,
        displayName: null,
        lastLoginAt: new Date('2026-08-07T05:40:00.000Z'),
      },
      appPublicUrl: 'http://192.168.55.71:3000',
    });

    const session = await service.describe(STAFF_ACCOUNT_ID);

    expect(session.displayName).toBe('Admin');
    expect(session.environment).toBe('internal_test');
  });

  // Exposes nothing beyond what holding the session already implies — in
  // particular no email (the ADMIN_EMAILS value AdminAuthGuard checks), no
  // role, no account id, and no child data of any kind.
  it('returns exactly three fields', async () => {
    const { service } = buildService({
      appPublicUrl: 'https://api.skillstreak.xyz',
    });

    const session = await service.describe(STAFF_ACCOUNT_ID);

    expect(Object.keys(session).sort()).toEqual([
      'authenticatedAt',
      'displayName',
      'environment',
    ]);
  });

  it('treats a StaffAccount hard-deleted between guard and handler as an invalid session', async () => {
    const { service } = buildService({ account: null });

    await expect(service.describe(STAFF_ACCOUNT_ID)).rejects.toThrow(
      StaffUnauthorizedException,
    );
  });
});
