import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { StaffAccountNotPtException } from '../../common/errors/exceptions';
import { StaffAccountRole } from '../entities/staff-account.entity';
import { StaffAuthGuard } from './staff-auth.guard';

// ADR-0023 Decision B2/B4 — extends StaffAuthGuard's cheap cookie check
// plus confirms `role === 'pt'` from the JWT hint. Deliberately NO
// per-request StaffAccount lookup for revocation here — unlike
// AdminAuthGuard, per the ADR's own reasoning: a `pt`-role session carries
// no ambient authority whatsoever by construction (Decision A1/B1) until
// Part A's own consent chain (PtTeamLink/PtPlayerConsent, not built by
// this task) grants something specific, each already gated by its own
// live relationship check. There is no "removed access but the session
// still grants everything" gap on this side to close, so there's nothing
// this guard's own per-request DB lookup would buy over trusting the JWT
// claim.
@Injectable()
export class PtAuthGuard implements CanActivate {
  constructor(private readonly staffAuthGuard: StaffAuthGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.staffAuthGuard.canActivate(context);
    const request = context.switchToHttp().getRequest<Request>();

    if (request.staffRole !== StaffAccountRole.PT) {
      throw new StaffAccountNotPtException();
    }

    return true;
  }
}
