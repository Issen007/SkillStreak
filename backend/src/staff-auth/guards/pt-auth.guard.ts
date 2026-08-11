import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import {
  StaffAccountGoneException,
  StaffAccountNotPtException,
  StaffAccountRevokedException,
} from '../../common/errors/exceptions';
import {
  StaffAccount,
  StaffAccountRole,
} from '../entities/staff-account.entity';
import { StaffAuthGuard } from './staff-auth.guard';

// ADR-0023 Decision B2/B4 — extends StaffAuthGuard's cheap cookie check
// with a role check and a per-request StaffAccount lookup.
//
// **That lookup was deliberately absent until 2026-08-11, on reasoning
// that had expired.** Decision B2 argued a `pt` session carries no ambient
// authority "until Part A's own consent chain (PtTeamLink/
// PtPlayerConsent, *not built by this task*) grants something specific".
// Part A shipped. A trainer holding an approved PtPlayerConsent has real,
// standing access to a named child's streaks, complete training history
// and badges — so "removed access but the session still grants
// everything" is exactly the gap that existed here.
//
// Found by the security review of the admin-as-trainer change (which was
// itself sound; it restated this premise, which is how the staleness
// surfaced). The concrete failure: an operator learns a trainer is
// abusive and sets `revoked_at` — the lever StaffAccount.revokedAt's own
// docstring calls "every current and future session immediately" — and
// nothing changes. Team-link revocation belongs to the captain and
// consent revocation to the parent, so this is the operator's ONLY
// unilateral lever, and on this surface it did nothing at all.
//
// Decision B2's cost argument for omitting it ("the high-volume player
// request path") never applied: /pt traffic is a handful of adults at
// human frequency, identical to /admin, which has always done this.
@Injectable()
export class PtAuthGuard implements CanActivate {
  constructor(
    private readonly staffAuthGuard: StaffAuthGuard,
    @InjectRepository(StaffAccount)
    private readonly staffAccountRepository: Repository<StaffAccount>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.staffAuthGuard.canActivate(context);
    const request = context.switchToHttp().getRequest<Request>();

    // ADMIN is admitted alongside PT (2026-08-11) so the project owner can
    // reach the trainer surface from their own account instead of needing a
    // second Google identity to see half the console. It grants nothing:
    // every route behind this guard re-derives its grant live from
    // (staffAccountId, teamId/playerId), so an admin with no PtTeamLink
    // reaches empty lists, and the human gates are untouched — a captain
    // (a Player, via PtTeamLinksController) issues the invite code, and a
    // parent approves each child.
    //
    // An allow-list of two rather than "anything with a session". Both
    // members of StaffAccountRole are currently in it, so this constrains
    // nothing today — it is a guard rail for a third role, not a live
    // check, and should not be described as one.
    const role = request.staffRole;
    if (role !== StaffAccountRole.PT && role !== StaffAccountRole.ADMIN) {
      throw new StaffAccountNotPtException();
    }

    const account = await this.staffAccountRepository.findOne({
      where: { id: request.staffAccountId },
    });
    if (!account) {
      // Validly-signed session, no row — same treatment AdminAuthGuard
      // gives it, and recorded under its own error_name because it points
      // at the database rather than at the caller.
      throw new StaffAccountGoneException();
    }
    if (account.revokedAt) {
      throw new StaffAccountRevokedException();
    }

    return true;
  }
}
