import { ExecutionContext } from '@nestjs/common';
import {
  StaffAccountGoneException,
  StaffAccountNotPtException,
  StaffAccountRevokedException,
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

// ADR-0023 Decision B2/B4, as amended 2026-08-11: this guard now DOES a
// per-request StaffAccount lookup, like AdminAuthGuard. The original
// reasoning ("a pt session carries no ambient authority... pending Part
// A") expired when Part A shipped — a trainer with an approved consent has
// standing access to a named child's whole training history, so revocation
// has to bite here too.
describe('PtAuthGuard', () => {
  function buildGuard(
    sessionRole: StaffAccountRole,
    account: Record<string, unknown> | null = {
      id: 'staff-1',
      revokedAt: null,
    },
  ) {
    const staffSessionTokenService = {
      verify: jest
        .fn()
        .mockResolvedValue({ sub: 'staff-1', role: sessionRole }),
    };
    const staffAuthGuard = new StaffAuthGuard(
      staffSessionTokenService as never,
    );
    const staffAccountRepository = {
      findOne: jest.fn().mockResolvedValue(account),
    };
    return new PtAuthGuard(staffAuthGuard, staffAccountRepository as never);
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

  /**
   * The finding that held the admin-as-trainer commit: revocation did
   * nothing on this surface. An operator who learns a trainer is abusive
   * sets `revoked_at` — the only lever they hold, since team-link
   * revocation belongs to the captain and consent revocation to the parent
   * — and the trainer kept reading a consented child's streaks, whole
   * training history and badges. Not even bounded by the 24h session,
   * because login minted a fresh one without looking.
   */
  it('refuses a revoked account', async () => {
    const guard = buildGuard(StaffAccountRole.PT, {
      id: 'staff-1',
      revokedAt: new Date(),
    });
    const { context } = buildContext({ staff_session: 'valid-token' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      StaffAccountRevokedException,
    );
  });

  it('refuses a session whose account row is gone', async () => {
    const guard = buildGuard(StaffAccountRole.PT, null);
    const { context } = buildContext({ staff_session: 'valid-token' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      StaffAccountGoneException,
    );
  });

  it('revocation bites an admin acting as a trainer too', async () => {
    const guard = buildGuard(StaffAccountRole.ADMIN, {
      id: 'staff-1',
      revokedAt: new Date(),
    });
    const { context } = buildContext({ staff_session: 'valid-token' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      StaffAccountRevokedException,
    );
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
