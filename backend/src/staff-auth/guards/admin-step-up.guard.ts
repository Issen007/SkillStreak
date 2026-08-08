import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import {
  StaffStepUpRequiredException,
  StaffUnauthorizedException,
} from '../../common/errors/exceptions';
import { StaffAccount } from '../entities/staff-account.entity';
import { AdminAuthGuard } from './admin-auth.guard';

// How long a re-authentication keeps the planning pillar unlocked. Short
// enough that a walked-away-from session doesn't stay unlocked, long
// enough that an operator reading three lists isn't re-prompted mid-task.
// Deliberately much longer than StaffAuthService's STEP_UP_MAX_AUTH_AGE_MS
// (which bounds how stale the IdP's own auth_time may be at callback) —
// the two answer different questions and must not be conflated.
export const ADMIN_STEP_UP_FRESHNESS_MS = 15 * 60 * 1000;

/**
 * ADR-0022 Decision 10's "fresh `authenticatedAt`" check, gating the three
 * `planning/*` endpoints and nothing else.
 *
 * Composed on top of AdminAuthGuard rather than replacing it: everything
 * that guard enforces (revocation, the live ADMIN_EMAILS re-comparison, a
 * real per-request row lookup) still applies, and this only adds the extra
 * recency requirement the Decision argues this one pillar needs. A stale
 * session is NOT signed out — it stays perfectly valid for the rest of the
 * console, and gets a distinct 401 the UI turns into a re-auth prompt
 * (docs/design/phase7-admin-console-flows.md §8, AD5) rather than dumping
 * the operator back to the sign-in screen and losing their console state.
 *
 * `lastLoginAt` is the freshness source because it is only ever written by
 * StaffAuthService.provisionOrRefreshAccount — i.e. by a completed OIDC
 * callback. Since 2026-08-08 a step-up callback additionally proves the
 * IdP genuinely re-authenticated (the `auth_time` check), so a stamp
 * written by a step-up flow means what this guard needs it to mean.
 */
@Injectable()
export class AdminStepUpGuard implements CanActivate {
  constructor(
    private readonly adminAuthGuard: AdminAuthGuard,
    @InjectRepository(StaffAccount)
    private readonly staffAccountRepository: Repository<StaffAccount>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.adminAuthGuard.canActivate(context);
    const request = context.switchToHttp().getRequest<Request>();
    const staffAccountId = request.staffAccountId;
    if (!staffAccountId) {
      throw new StaffUnauthorizedException();
    }

    const account = await this.staffAccountRepository.findOne({
      where: { id: staffAccountId },
    });
    if (!account) {
      throw new StaffUnauthorizedException();
    }

    // Fail closed on a null lastLoginAt: an account row that has never
    // recorded a login has not proven recency, and this pillar is the one
    // place in the console where "probably fine" is not the right default.
    const lastLoginAt = account.lastLoginAt;
    if (
      !lastLoginAt ||
      Date.now() - lastLoginAt.getTime() > ADMIN_STEP_UP_FRESHNESS_MS
    ) {
      throw new StaffStepUpRequiredException();
    }

    return true;
  }
}
