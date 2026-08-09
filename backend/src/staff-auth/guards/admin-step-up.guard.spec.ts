import { ExecutionContext } from '@nestjs/common';
import {
  ADMIN_STEP_UP_FRESHNESS_MS,
  AdminStepUpGuard,
} from './admin-step-up.guard';

function buildContext(stepUpAt?: number) {
  const request: { staffAccountId?: string; staffStepUpAt?: number } = {
    staffAccountId: 'staff-1',
    staffStepUpAt: stepUpAt,
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function buildGuard(options: { adminAuthThrows?: Error } = {}) {
  const adminAuthGuard = {
    canActivate: options.adminAuthThrows
      ? jest.fn().mockRejectedValue(options.adminAuthThrows)
      : jest.fn().mockResolvedValue(true),
  };
  const guard = new AdminStepUpGuard(adminAuthGuard as never);
  return { guard, adminAuthGuard };
}

const secondsAgo = (ms: number) => Math.floor((Date.now() - ms) / 1000);

// docs/adr/0022-admin-control-center.md Decision 10's step-up gate, as
// corrected 2026-08-08 after a blocking security review.
describe('AdminStepUpGuard', () => {
  it('allows a session carrying a recent verified step-up claim', async () => {
    const { guard } = buildGuard();

    await expect(
      guard.canActivate(buildContext(secondsAgo(60_000))),
    ).resolves.toBe(true);
  });

  it('rejects a stale step-up with reauth_required — a 401 the console turns into a re-auth prompt, not a sign-out', async () => {
    const { guard } = buildGuard();

    await expect(
      guard.canActivate(
        buildContext(secondsAgo(ADMIN_STEP_UP_FRESHNESS_MS + 60_000)),
      ),
    ).rejects.toMatchObject({ code: 'reauth_required', status: 401 });
  });

  // THE regression this guard was rewritten for. An ordinary /login issues
  // a session with no stepUpAt claim at all: it sends no prompt=login, runs
  // no auth_time check, and typically completes with zero user interaction
  // against a live IdP SSO session. Before the fix it satisfied this gate,
  // because the gate read a StaffAccount column that every login stamps.
  it('rejects an ordinary login session, which carries no step-up claim', async () => {
    const { guard } = buildGuard();

    await expect(
      guard.canActivate(buildContext(undefined)),
    ).rejects.toMatchObject({ code: 'reauth_required' });
  });

  // The proof is session-scoped, so it cannot be inherited. A stolen cookie
  // must not become privileged because the real operator signed in again
  // somewhere else.
  it('ignores anything but this session’s own claim (no account-wide state is consulted)', async () => {
    const { guard } = buildGuard();
    const context = buildContext(undefined);

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: 'reauth_required',
    });
  });

  it('rejects a non-numeric claim', async () => {
    const { guard } = buildGuard();
    const request = { staffAccountId: 'staff-1', staffStepUpAt: 'soon' };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: 'reauth_required',
    });
  });

  // This guard only ever ADDS a requirement — everything AdminAuthGuard
  // enforces (revocation, the live ADMIN_EMAILS re-check) must still run
  // first, and its rejection must win.
  it('runs AdminAuthGuard first and propagates its rejection untouched', async () => {
    const notAdmin = Object.assign(new Error('nope'), { code: 'not_admin' });
    const { guard, adminAuthGuard } = buildGuard({ adminAuthThrows: notAdmin });

    await expect(
      guard.canActivate(buildContext(secondsAgo(1000))),
    ).rejects.toMatchObject({ code: 'not_admin' });
    expect(adminAuthGuard.canActivate).toHaveBeenCalledTimes(1);
  });
});
