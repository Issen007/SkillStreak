import { ExecutionContext } from '@nestjs/common';
import {
  StaffAccountNotAdminException,
  StaffAccountRevokedException,
  StaffUnauthorizedException,
} from '../../common/errors/exceptions';
import {
  StaffAccountRole,
  StaffAuthProvider,
} from '../entities/staff-account.entity';
import { StaffAuthGuard } from './staff-auth.guard';
import { AdminAuthGuard } from './admin-auth.guard';

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

// ADR-0023 Decision B1/B4, as amended by security-reviewer's Part B pass
// (Finding 1 — see the ADR's Status): AdminAuthGuard must do a real
// per-request StaffAccount lookup, never trusting the JWT's `role` claim
// or the StaffAccount.role column as authoritative.
describe('AdminAuthGuard', () => {
  function buildGuard(options: {
    sessionRole?: StaffAccountRole;
    account: {
      id: string;
      email: string;
      role: StaffAccountRole;
      authProvider: StaffAuthProvider;
      revokedAt: Date | null;
    } | null;
    adminEmails?: string;
  }) {
    const staffSessionTokenService = {
      verify: jest.fn().mockResolvedValue({
        sub: 'staff-1',
        role: options.sessionRole ?? StaffAccountRole.ADMIN,
      }),
    };
    const staffAuthGuard = new StaffAuthGuard(
      staffSessionTokenService as never,
    );

    const configService = {
      get: jest.fn((key: string) =>
        key === 'ADMIN_EMAILS' ? (options.adminEmails ?? '') : undefined,
      ),
    };

    const staffAccountRepository = {
      findOne: jest.fn().mockResolvedValue(options.account),
    };

    const guard = new AdminAuthGuard(
      staffAuthGuard,
      configService as never,
      staffAccountRepository as never,
    );

    return { guard, staffAccountRepository, configService };
  }

  it('rejects if there is no valid staff session at all (delegates to StaffAuthGuard)', async () => {
    const { guard, staffAccountRepository } = buildGuard({
      account: {
        id: 'staff-1',
        email: 'admin@example.com',
        role: StaffAccountRole.ADMIN,
        authProvider: StaffAuthProvider.GOOGLE,
        revokedAt: null,
      },
      adminEmails: 'admin@example.com',
    });
    const { context } = buildContext({}); // no cookie at all

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      StaffUnauthorizedException,
    );
    expect(staffAccountRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects a revoked account even if its email is still on ADMIN_EMAILS and its role column says admin', async () => {
    const { guard } = buildGuard({
      account: {
        id: 'staff-1',
        email: 'admin@example.com',
        role: StaffAccountRole.ADMIN,
        authProvider: StaffAuthProvider.GOOGLE,
        revokedAt: new Date('2026-08-01T00:00:00Z'),
      },
      adminEmails: 'admin@example.com',
    });
    const { context } = buildContext({ staff_session: 'valid-token' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      StaffAccountRevokedException,
    );
  });

  it('rejects when the JWT role claim says admin but the account row is no longer on the live ADMIN_EMAILS allow-list (the exact gap security-reviewer Finding 1 closed)', async () => {
    const { guard } = buildGuard({
      sessionRole: StaffAccountRole.ADMIN, // stale JWT claim from before removal
      account: {
        id: 'staff-1',
        email: 'removed-admin@example.com',
        role: StaffAccountRole.ADMIN, // stale role column too
        authProvider: StaffAuthProvider.GOOGLE,
        revokedAt: null,
      },
      adminEmails: '', // removed from the live allow-list
    });
    const { context } = buildContext({ staff_session: 'valid-token' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      StaffAccountNotAdminException,
    );
  });

  it('grants admin authority purely off the live email/ADMIN_EMAILS match, even if the stored role column says pt', async () => {
    const { guard } = buildGuard({
      sessionRole: StaffAccountRole.PT,
      account: {
        id: 'staff-1',
        email: 'admin@example.com',
        role: StaffAccountRole.PT, // stale/wrong role column, irrelevant
        authProvider: StaffAuthProvider.GOOGLE,
        revokedAt: null,
      },
      adminEmails: 'Admin@Example.com', // case-insensitive match
    });
    const { context } = buildContext({ staff_session: 'valid-token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects if the session points at a StaffAccount row that no longer exists', async () => {
    const { guard } = buildGuard({
      account: null,
      adminEmails: 'x@example.com',
    });
    const { context } = buildContext({ staff_session: 'valid-token' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      StaffUnauthorizedException,
    );
  });

  it("compares Apple's persisted (frozen) email the same way as Google/Microsoft's live one — no special-cased branch needed", async () => {
    const { guard } = buildGuard({
      account: {
        id: 'staff-1',
        email: 'frozen-apple-admin@example.com',
        role: StaffAccountRole.ADMIN,
        authProvider: StaffAuthProvider.APPLE,
        revokedAt: null,
      },
      adminEmails: 'frozen-apple-admin@example.com',
    });
    const { context } = buildContext({ staff_session: 'valid-token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('performs a real per-request DB lookup every call, not a cached one', async () => {
    const { guard, staffAccountRepository } = buildGuard({
      account: {
        id: 'staff-1',
        email: 'admin@example.com',
        role: StaffAccountRole.ADMIN,
        authProvider: StaffAuthProvider.GOOGLE,
        revokedAt: null,
      },
      adminEmails: 'admin@example.com',
    });

    await guard.canActivate(
      buildContext({ staff_session: 'valid-token' }).context,
    );
    await guard.canActivate(
      buildContext({ staff_session: 'valid-token' }).context,
    );

    expect(staffAccountRepository.findOne).toHaveBeenCalledTimes(2);
  });
});
