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

  it('rejects an admin-role session (this guard is pt-only)', async () => {
    const guard = buildGuard(StaffAccountRole.ADMIN);
    const { context } = buildContext({ staff_session: 'valid-token' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      StaffAccountNotPtException,
    );
  });
});
