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

    // Admins may also act as a trainer. This grants NOTHING on its own,
    // which is the same property this guard's own comment above relies on:
    // a session on this side carries no ambient authority until Part A's
    // consent chain grants something specific, and every one of those
    // grants is checked live against (staffAccountId, teamId/playerId).
    //
    // So an admin reaching a /pt route sees exactly what an admin has been
    // *given* — which, with no PtTeamLink, is an empty list. The gates that
    // matter are unchanged: a captain (a Player, via PtTeamLinksController)
    // still has to issue an invite code, and a parent still has to approve
    // each individual child.
    //
    // Added 2026-08-11 so the project owner can test the trainer surface
    // from their own account and be invited to a real team, rather than
    // needing a second Google account to see half the console.
    //
    // The honest residual: an admin with database access could read an
    // invite code out of Postgres. That is true of any admin today and is
    // not a capability this adds — an admin cannot mint one, because code
    // generation is behind JwtAuthGuard and a captain's own player id.
    const role = request.staffRole;
    if (role !== StaffAccountRole.PT && role !== StaffAccountRole.ADMIN) {
      throw new StaffAccountNotPtException();
    }

    return true;
  }
}
