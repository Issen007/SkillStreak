import { ExecutionContext } from '@nestjs/common';
import {
  StaffAccountNotPtException,
  StaffUnauthorizedException,
} from '../../common/errors/exceptions';
import { StaffAccountRole } from '../entities/staff-account.entity';
import { StaffAuthGuard } from './staff-auth.guard';
import { PtAuthGuard } from './pt-auth.guard';

function buildContext(cookies: Record<string, string> = {}) {
  const request: {
    cookies: Record<string, string>;
    staffAccountId?: string;
    staffRole?: StaffAccountRole;
  } = { cookies };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

// ADR-0023 Decision B2/B4 — deliberately NO per-request DB lookup here,
// unlike AdminAuthGuard: a pt-role session carries no ambient authority by
// construction, per the ADR's own reasoning (see that guard's header
// comment). This guard only ever needs the cheap JWT-claim check.
describe('PtAuthGuard', () => {
  function buildGuard(sessionRole: StaffAccountRole) {
    const staffSessionTokenService = {
      verify: jest
        .fn()
        .mockResolvedValue({ sub: 'staff-1', role: sessionRole }),
    };
    const staffAuthGuard = new StaffAuthGuard(
      staffSessionTokenService as never,
    );
    return new PtAuthGuard(staffAuthGuard);
  }

  it('rejects a request with no valid staff session at all', async () => {
    const guard = buildGuard(StaffAccountRole.PT);
    const { context } = buildContext({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      StaffUnauthorizedException,
    );
  });

  it('allows a pt-role session through', async () => {
    const guard = buildGuard(StaffAccountRole.PT);
    const { context } = buildContext({ staff_session: 'valid-token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  /**
   * Changed 2026-08-11. This used to assert an admin was refused outright.
   *
   * Letting an admin through grants nothing, which is the same property
   * this guard's own docstring is built on: a session here carries no
   * ambient authority until Part A's consent chain grants something
   * specific, and every one of those grants is re-checked live against
   * (staffAccountId, teamId/playerId). An admin with no PtTeamLink reaches
   * an empty list.
   *
   * What it buys: the project owner can be invited to a real team from
   * their own account, instead of needing a second Google identity to see
   * half of their own console.
   */
  it('allows an admin-role session through, which grants nothing by itself', async () => {
    const guard = buildGuard(StaffAccountRole.ADMIN);
    const { context } = buildContext({ staff_session: 'valid-token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('still refuses a role it does not recognise', async () => {
    // Two named roles, not "anything holding a session" — so a future role
    // added for some unrelated purpose does not silently inherit the
    // trainer surface.
    const guard = buildGuard('auditor' as StaffAccountRole);
    const { context } = buildContext({ staff_session: 'valid-token' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      StaffAccountNotPtException,
    );
  });
});
