import { ExecutionContext } from '@nestjs/common';
import {
  StaffSessionExpiredException,
  StaffSessionInvalidException,
  StaffSessionMissingException,
  StaffUnauthorizedException,
} from '../../common/errors/exceptions';
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

/**
 * Added 2026-08-11. The admin Errors tab used to show one message for
 * every 401, which conflated "nobody signed in" with "the signature does
 * not verify" — situations an operator acts on very differently, the
 * second usually meaning STAFF_JWT_SECRET does not match what minted the
 * token.
 *
 * The distinction is carried by the exception CLASS, which lands in
 * error_log_entry.error_name. It must never reach the response: a caller
 * told "expired" rather than "invalid" learns their signature verified,
 * which is an oracle for the secret.
 */
describe('StaffAuthGuard failure reasons', () => {
  function contextWith(cookies: Record<string, string> | undefined) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ cookies }) }),
    } as never;
  }

  function guardWith(verify: jest.Mock) {
    return new StaffAuthGuard({ verify } as never);
  }

  it('distinguishes a missing cookie', async () => {
    const guard = guardWith(jest.fn());

    await expect(guard.canActivate(contextWith({}))).rejects.toBeInstanceOf(
      StaffSessionMissingException,
    );
  });

  it('distinguishes an expired token', async () => {
    const expired = Object.assign(new Error('jwt expired'), {
      name: 'TokenExpiredError',
    });
    const guard = guardWith(jest.fn().mockRejectedValue(expired));

    await expect(
      guard.canActivate(contextWith({ staff_session: 'token' })),
    ).rejects.toBeInstanceOf(StaffSessionExpiredException);
  });

  it('distinguishes a signature that does not verify', async () => {
    const bad = Object.assign(new Error('invalid signature'), {
      name: 'JsonWebTokenError',
    });
    const guard = guardWith(jest.fn().mockRejectedValue(bad));

    await expect(
      guard.canActivate(contextWith({ staff_session: 'token' })),
    ).rejects.toBeInstanceOf(StaffSessionInvalidException);
  });

  it('keeps one code and one message across all three', () => {
    const reasons = [
      new StaffSessionMissingException(),
      new StaffSessionExpiredException(),
      new StaffSessionInvalidException(),
    ];

    // The operator gets the difference through error_name; the caller must
    // not, or "expired" becomes a confirmation that the signature was good.
    expect(new Set(reasons.map((e) => e.code))).toEqual(
      new Set(['staff_unauthorized']),
    );
    expect(new Set(reasons.map((e) => e.message))).toEqual(
      new Set(['Missing or invalid staff session.']),
    );
    expect(new Set(reasons.map((e) => e.constructor.name)).size).toBe(3);
  });
});
