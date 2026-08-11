import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { readAdminEmailAllowList } from './admin-email-allow-list.util';
import {
  StaffAccount,
  StaffAccountRole,
} from './entities/staff-account.entity';
import { StaffSessionTokenService } from './staff-session-token.service';

export interface StaffSessionView {
  authenticated: boolean;
  /** Absent when not authenticated. */
  role?: StaffAccountRole;
  displayName?: string | null;
}

/**
 * Answers "who is this, if anyone" **without throwing**.
 *
 * Exists because asking that question used to cost an error row. The
 * console's role detection called `GET /admin/session` on load and treated
 * a 401 as "not signed in" — so every signed-out page load wrote a
 * `staff_unauthorized` entry into `error_log_entry`, and the admin Errors
 * tab filled with the console asking a question it was designed to ask.
 * An expected answer should not travel as an exception.
 *
 * The alternative — suppressing 401s on that route in the error log — was
 * rejected: it hides a genuine signal (someone's session expiring, a
 * misconfigured `STAFF_JWT_SECRET`) to work around a client-side design
 * choice.
 *
 * **Not a security boundary.** Nothing is authorised here and no data is
 * returned that a caller could not learn by trying a real endpoint. Every
 * `/admin/*` and `/pt/*` route keeps its own guard, and those guards remain
 * the only thing deciding access — this only tells a page which navigation
 * to draw.
 *
 * The admin check is deliberately the *live* one AdminAuthGuard performs
 * (revoked row, then current email against the current ADMIN_EMAILS), not
 * the JWT's `role` claim. Trusting the claim would let the console show
 * admin tabs to someone removed from the allow-list hours ago — every
 * request behind them would 403, which looks like a broken console rather
 * than a revoked account.
 */
@Injectable()
export class StaffSessionViewService {
  constructor(
    private readonly staffSessionTokenService: StaffSessionTokenService,
    private readonly configService: ConfigService,
    @InjectRepository(StaffAccount)
    private readonly staffAccountRepository: Repository<StaffAccount>,
  ) {}

  async describe(token: string | undefined): Promise<StaffSessionView> {
    if (!token) return { authenticated: false };

    let staffAccountId: string;
    try {
      const payload = await this.staffSessionTokenService.verify(token);
      staffAccountId = payload.sub;
    } catch {
      // Expired or unverifiable. From this endpoint's point of view that
      // is simply "not signed in" — the caller's next move is the same
      // either way, and distinguishing them here would leak whether a
      // presented token was ever real.
      return { authenticated: false };
    }

    const account = await this.staffAccountRepository.findOne({
      where: { id: staffAccountId },
    });
    if (!account || account.revokedAt) {
      return { authenticated: false };
    }

    const adminEmails = readAdminEmailAllowList(this.configService);
    const role = adminEmails.has(account.email.trim().toLowerCase())
      ? StaffAccountRole.ADMIN
      : StaffAccountRole.PT;

    return {
      authenticated: true,
      role,
      displayName: account.displayName,
    };
  }
}
