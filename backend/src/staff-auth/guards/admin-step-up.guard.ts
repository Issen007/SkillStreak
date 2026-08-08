import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { StaffStepUpRequiredException } from '../../common/errors/exceptions';
import { AdminAuthGuard } from './admin-auth.guard';

// How long a verified re-authentication keeps the planning pillar
// unlocked. Short enough that a walked-away-from session doesn't stay
// unlocked, long enough that an operator reading three lists isn't
// re-prompted mid-task. Deliberately longer than StaffAuthService's
// STEP_UP_MAX_AUTH_AGE_MS (which bounds how stale the IdP's own auth_time
// may be at callback) — the two answer different questions.
export const ADMIN_STEP_UP_FRESHNESS_MS = 15 * 60 * 1000;

/**
 * ADR-0022 Decision 10's step-up gate, on the three `planning/*` endpoints
 * and nothing else.
 *
 * Composed on top of AdminAuthGuard rather than replacing it: everything
 * that guard enforces (revocation, the live ADMIN_EMAILS re-comparison, a
 * real per-request row lookup) still applies, and this only adds the extra
 * recency requirement the Decision argues this one pillar needs. A stale
 * session is NOT signed out — it stays perfectly valid for the rest of the
 * console, and gets a distinct 401 the UI turns into a re-auth prompt
 * rather than dumping the operator back to the sign-in screen.
 *
 * **Corrected 2026-08-08 after a blocking security review.** The first
 * implementation read `StaffAccount.lastLoginAt`, which failed to gate
 * anything: that column is stamped by *every* completed OIDC callback, so
 * an ordinary `/login` — which sends no `prompt=login`, runs no `auth_time`
 * check, and typically completes with zero user interaction against a live
 * IdP SSO session — opened the pillar just as well as a real step-up. It
 * was also account-scoped, so a stolen session was upgraded by the
 * victim's own unrelated sign-in in another browser. The `/step-up` route's
 * verified `auth_time` was computed and then thrown away.
 *
 * Now the proof is a claim on the presenting session (StaffJwtPayload
 * .stepUpAt), written only by a step-up callback that verified the IdP's
 * `auth_time`. A session without that claim can never satisfy this guard,
 * no matter who else signs in or how recently.
 */
@Injectable()
export class AdminStepUpGuard implements CanActivate {
  constructor(private readonly adminAuthGuard: AdminAuthGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.adminAuthGuard.canActivate(context);
    const request = context.switchToHttp().getRequest<Request>();

    // Fail closed on an absent claim: an ordinary login carries none, and
    // that is precisely the case this guard exists to refuse.
    const stepUpAt = request.staffStepUpAt;
    if (
      typeof stepUpAt !== 'number' ||
      Date.now() - stepUpAt * 1000 > ADMIN_STEP_UP_FRESHNESS_MS
    ) {
      throw new StaffStepUpRequiredException();
    }

    return true;
  }
}
