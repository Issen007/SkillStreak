import { ConfigService } from '@nestjs/config';
import { StaffAccountRole } from './entities/staff-account.entity';
import { StaffSessionViewService } from './staff-session-view.service';

function buildService(
  overrides: {
    verify?: jest.Mock;
    account?: Record<string, unknown> | null;
    adminEmails?: string;
  } = {},
) {
  const verify =
    overrides.verify ?? jest.fn().mockResolvedValue({ sub: 'staff-1' });
  const findOne = jest.fn().mockResolvedValue(
    overrides.account === undefined
      ? {
          id: 'staff-1',
          email: 'boss@example.com',
          displayName: 'Boss',
          revokedAt: null,
        }
      : overrides.account,
  );

  const service = new StaffSessionViewService(
    { verify } as never,
    new ConfigService({ ADMIN_EMAILS: overrides.adminEmails ?? '' }),
    { findOne } as never,
  );

  return { service, verify, findOne };
}

/**
 * The whole point of this service is that asking "am I signed in" is free.
 * Every test below is really the same assertion: it resolves, it does not
 * throw, and therefore it writes no row into the admin error log.
 */
describe('StaffSessionViewService.describe', () => {
  it('answers "not authenticated" for a missing cookie without throwing', async () => {
    const { service } = buildService();

    await expect(service.describe(undefined)).resolves.toEqual({
      authenticated: false,
    });
  });

  it('answers "not authenticated" for an expired or unverifiable token', async () => {
    const { service } = buildService({
      verify: jest.fn().mockRejectedValue(new Error('jwt expired')),
    });

    // The caller's next move is identical either way, and distinguishing
    // them here would leak whether a presented token was ever real.
    await expect(service.describe('stale-token')).resolves.toEqual({
      authenticated: false,
    });
  });

  it('answers "not authenticated" when the account row is gone', async () => {
    const { service } = buildService({ account: null });

    await expect(service.describe('token')).resolves.toEqual({
      authenticated: false,
    });
  });

  it('answers "not authenticated" for a revoked account', async () => {
    const { service } = buildService({
      account: {
        id: 'staff-1',
        email: 'boss@example.com',
        displayName: 'Boss',
        revokedAt: new Date(),
      },
    });

    await expect(service.describe('token')).resolves.toEqual({
      authenticated: false,
    });
  });

  it('reports admin when the email is on the live allow-list', async () => {
    const { service } = buildService({ adminEmails: 'boss@example.com' });

    await expect(service.describe('token')).resolves.toEqual({
      authenticated: true,
      role: StaffAccountRole.ADMIN,
      displayName: 'Boss',
    });
  });

  it('reports pt when the email is not on the list', async () => {
    const { service } = buildService({
      adminEmails: 'someone-else@example.com',
    });

    await expect(service.describe('token')).resolves.toEqual({
      authenticated: true,
      role: StaffAccountRole.PT,
      displayName: 'Boss',
    });
  });

  it('derives the role from the live list, not the token claim', async () => {
    // Someone removed from ADMIN_EMAILS an hour ago still holds a session
    // whose JWT says `admin`. Trusting the claim would draw admin tabs
    // whose every request then 403s — which reads as a broken console
    // rather than a revoked account.
    const { service } = buildService({
      verify: jest
        .fn()
        .mockResolvedValue({ sub: 'staff-1', role: StaffAccountRole.ADMIN }),
      adminEmails: '',
    });

    await expect(service.describe('token')).resolves.toMatchObject({
      role: StaffAccountRole.PT,
    });
  });

  it('matches the allow-list case-insensitively, as the guard does', async () => {
    const { service } = buildService({ adminEmails: '  BOSS@Example.COM  ' });

    await expect(service.describe('token')).resolves.toMatchObject({
      role: StaffAccountRole.ADMIN,
    });
  });
});
