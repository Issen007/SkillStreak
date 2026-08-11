import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import {
  StaffAccountGoneException,
  StaffAccountNotAdminException,
  StaffAccountRevokedException,
  StaffUnauthorizedException,
} from '../../common/errors/exceptions';
import { readAdminEmailAllowList } from '../admin-email-allow-list.util';
import { StaffAccount } from '../entities/staff-account.entity';
import { StaffAuthGuard } from './staff-auth.guard';

// ADR-0023 Decision B1/B2/B4, as amended by security-reviewer's Part B pass
// (Finding 1 — see the ADR's Status section; this guard IS that fix).
//
// Built on StaffAuthGuard's cheap cookie check, but — unlike PtAuthGuard —
// adds a real, per-request StaffAccount lookup rather than trusting the
// JWT's `role` claim or the StaffAccount.role column as authoritative:
//
//   1. Reject immediately if `revoked_at` is non-null (the manual
//      suspension lever — the only reliable revocation for an
//      Apple-authenticated account, whose persisted email may never be
//      re-checkable against ADMIN_EMAILS again after first login).
//   2. Re-compare this account's current `email` against the *live*
//      ADMIN_EMAILS config (an in-memory ConfigService read, not its own
//      DB round trip). For Google/Microsoft this is genuinely live — the
//      row's `email` is refreshed every login. For Apple, `email` was
//      frozen at first login (Apple omits that claim on every login
//      after the first) — the comparison itself doesn't need to branch on
//      provider, since either way it's "does this row's current `email`
//      match the live allow-list right now," which is exactly what should
//      happen in both cases (see Decision B1's named Apple exception).
//
// Mirrors JwtAuthGuard's token_version per-request check (ADR-0004 Part
// 3) — proportionate here because admin traffic is low-volume, infrequent
// operator use, not that guard's high-volume player request path.
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly staffAuthGuard: StaffAuthGuard,
    private readonly configService: ConfigService,
    @InjectRepository(StaffAccount)
    private readonly staffAccountRepository: Repository<StaffAccount>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.staffAuthGuard.canActivate(context);
    const request = context.switchToHttp().getRequest<Request>();
    const staffAccountId = request.staffAccountId;
    if (!staffAccountId) {
      // Unreachable given StaffAuthGuard's own contract (it either throws
      // or sets this field) — kept as a defensive backstop, same posture
      // as this codebase's other "should be unreachable" checks.
      throw new StaffUnauthorizedException();
    }

    const account = await this.staffAccountRepository.findOne({
      where: { id: staffAccountId },
    });
    if (!account) {
      // A validly-signed session for a StaffAccount row that no longer
      // exists (e.g. hard-deleted directly in Postgres) — treated the
      // same as an invalid session on the wire, but recorded under its own
      // error_name, since it points at the database rather than at the
      // caller.
      throw new StaffAccountGoneException();
    }
    if (account.revokedAt) {
      throw new StaffAccountRevokedException();
    }

    const adminEmails = readAdminEmailAllowList(this.configService);
    if (!adminEmails.has(account.email.trim().toLowerCase())) {
      throw new StaffAccountNotAdminException();
    }

    return true;
  }
}
