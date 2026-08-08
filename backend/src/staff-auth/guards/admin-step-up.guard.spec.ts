import { ExecutionContext } from '@nestjs/common';
import { StaffUnauthorizedException } from '../../common/errors/exceptions';
import {
  ADMIN_STEP_UP_FRESHNESS_MS,
  AdminStepUpGuard,
} from './admin-step-up.guard';

function buildContext(staffAccountId?: string) {
  const request: { staffAccountId?: string } = { staffAccountId };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function buildGuard(options: {
  lastLoginAt?: Date | null;
  accountExists?: boolean;
  adminAuthThrows?: Error;
}) {
  const adminAuthGuard = {
    canActivate: options.adminAuthThrows
      ? jest.fn().mockRejectedValue(options.adminAuthThrows)
      : jest.fn().mockResolvedValue(true),
  };
  const staffAccountRepository = {
    findOne: jest
      .fn()
      .mockResolvedValue(
        options.accountExists === false
          ? null
          : { id: 'staff-1', lastLoginAt: options.lastLoginAt ?? null },
      ),
  };
  const guard = new AdminStepUpGuard(
    adminAuthGuard as never,
    staffAccountRepository as never,
  );
  return { guard, adminAuthGuard, staffAccountRepository };
}

// docs/adr/0022-admin-control-center.md Decision 10's fresh-authenticatedAt
// check, gating the three planning/* endpoints and nothing else.
describe('AdminStepUpGuard', () => {
  it('allows a session whose last login is inside the freshness window', async () => {
    const { guard } = buildGuard({ lastLoginAt: new Date(Date.now() - 1000) });

    await expect(guard.canActivate(buildContext('staff-1'))).resolves.toBe(
      true,
    );
  });

  it('rejects a stale session with reauth_required — a 401 the console turns into AD5, not a sign-out', async () => {
    const { guard } = buildGuard({
      lastLoginAt: new Date(Date.now() - ADMIN_STEP_UP_FRESHNESS_MS - 1000),
    });

    await expect(
      guard.canActivate(buildContext('staff-1')),
    ).rejects.toMatchObject({ code: 'reauth_required', status: 401 });
  });

  // Fail closed: an account that has never recorded a login has not proven
  // recency, and this is the one pillar where "probably fine" is wrong.
  it('rejects when lastLoginAt has never been stamped', async () => {
    const { guard } = buildGuard({ lastLoginAt: null });

    await expect(
      guard.canActivate(buildContext('staff-1')),
    ).rejects.toMatchObject({ code: 'reauth_required' });
  });

  // This guard only ever ADDS a requirement — everything AdminAuthGuard
  // enforces (revocation, the live ADMIN_EMAILS re-check) must still run
  // first, and its rejection must win.
  it('runs AdminAuthGuard first and propagates its rejection untouched', async () => {
    const notAdmin = Object.assign(new Error('nope'), { code: 'not_admin' });
    const { guard, staffAccountRepository } = buildGuard({
      adminAuthThrows: notAdmin,
    });

    await expect(
      guard.canActivate(buildContext('staff-1')),
    ).rejects.toMatchObject({ code: 'not_admin' });
    // Never even reached the freshness lookup.
    expect(staffAccountRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects when the StaffAccount row no longer exists', async () => {
    const { guard } = buildGuard({ accountExists: false });

    await expect(guard.canActivate(buildContext('staff-1'))).rejects.toThrow(
      StaffUnauthorizedException,
    );
  });
});
