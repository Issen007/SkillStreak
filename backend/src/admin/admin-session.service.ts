import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StaffUnauthorizedException } from '../common/errors/exceptions';
import { StaffAccount } from '../staff-auth/entities/staff-account.entity';
import {
  AdminEnvironment,
  resolveAdminEnvironment,
} from './admin-environment.util';

/**
 * docs/design/phase7-admin-console-flows.md §13's ask, verbatim: "a small
 * `GET /api/v1/admin/session` → `{ displayName, authenticatedAt,
 * environment }` (behind `AdminAuthGuard`) would let the console (a) know
 * it's signed in on first paint without firing a data request and
 * interpreting a 401, (b) render the 'Signed in as' identity chip, and (c)
 * render §2's environment badge."
 *
 * It exposes nothing that isn't already implied by holding a valid admin
 * session: the operator's own name, their own login time, and which cluster
 * they're talking to. No email (the allow-list value `AdminAuthGuard` checks
 * — no reason to put it on the wire), no role, no account id, and
 * emphatically no child data of any kind.
 */
export interface AdminSessionResponse {
  /** From `StaffAccount.display_name` (the ID token's `name` claim), or the
   * literal `'Admin'` when the provider gave none — Apple in particular
   * omits it after first login. Never an email address: §3/§8's identity
   * chip needs something to show, not a second copy of the allow-list. */
  displayName: string;
  authenticatedAt: string;
  environment: AdminEnvironment;
}

@Injectable()
export class AdminSessionService {
  constructor(
    @InjectRepository(StaffAccount)
    private readonly staffAccountRepository: Repository<StaffAccount>,
    private readonly configService: ConfigService,
  ) {}

  async describe(staffAccountId: string): Promise<AdminSessionResponse> {
    const account = await this.staffAccountRepository.findOne({
      where: { id: staffAccountId },
    });
    if (!account) {
      // AdminAuthGuard already loaded and validated this exact row moments
      // ago, so this is the narrow "hard-deleted directly in Postgres
      // between the guard and the handler" race. Treated as an invalid
      // session, matching the guard's own handling of the same case, rather
      // than surfaced as a 404 the console would have to interpret.
      throw new StaffUnauthorizedException();
    }

    return {
      displayName: account.displayName ?? 'Admin',
      // `last_login_at`, not the session JWT's `iat`. The guard deliberately
      // discards the raw token (StaffAuthGuard puts only `sub`/`role` on the
      // request), and re-verifying the cookie here just to read a claim
      // would duplicate authentication work for a display string. Named
      // residual: if the operator signs in again in a second browser, this
      // value moves ahead of *this* session's own issue time. Harmless for
      // an identity chip; do not build anything that treats it as this
      // session's expiry basis.
      authenticatedAt: account.lastLoginAt.toISOString(),
      environment: resolveAdminEnvironment(
        this.configService.get<string>('APP_PUBLIC_URL'),
      ),
    };
  }
}
