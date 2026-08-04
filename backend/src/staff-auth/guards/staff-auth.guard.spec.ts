import { ExecutionContext } from '@nestjs/common';
import { StaffUnauthorizedException } from '../../common/errors/exceptions';
import { StaffAccountRole } from '../entities/staff-account.entity';
import { StaffAuthGuard } from './staff-auth.guard';

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

describe('StaffAuthGuard', () => {
  it('rejects a request with no staff_session cookie at all', async () => {
    const staffSessionTokenService = { verify: jest.fn() };
    const guard = new StaffAuthGuard(staffSessionTokenService as never);
    const { context } = buildContext({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      StaffUnauthorizedException,
    );
    expect(staffSessionTokenService.verify).not.toHaveBeenCalled();
  });

  it('rejects an invalid/expired staff_session cookie', async () => {
    const staffSessionTokenService = {
      verify: jest.fn().mockRejectedValue(new Error('jwt expired')),
    };
    const guard = new StaffAuthGuard(staffSessionTokenService as never);
    const { context } = buildContext({ staff_session: 'stale-token' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      StaffUnauthorizedException,
    );
  });

  it('populates staffAccountId/staffRole from a valid cookie and allows the request through', async () => {
    const staffSessionTokenService = {
      verify: jest
        .fn()
        .mockResolvedValue({ sub: 'staff-1', role: StaffAccountRole.PT }),
    };
    const guard = new StaffAuthGuard(staffSessionTokenService as never);
    const { context, request } = buildContext({ staff_session: 'valid-token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.staffAccountId).toBe('staff-1');
    expect(request.staffRole).toBe(StaffAccountRole.PT);
  });
});
