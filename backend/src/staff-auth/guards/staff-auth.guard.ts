import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { StaffUnauthorizedException } from '../../common/errors/exceptions';
import { StaffAccountRole } from '../entities/staff-account.entity';
import { STAFF_SESSION_COOKIE_NAME } from '../staff-cookies';
import { StaffSessionTokenService } from '../staff-session-token.service';

// Request augmentation so downstream handlers/decorators can read the
// authenticated staffAccountId/role without re-parsing the cookie — same
// pattern as JwtAuthGuard's playerId augmentation (auth/jwt-auth.guard.ts).
declare module 'express' {
  interface Request {
    staffAccountId?: string;
    /** Last-known/display hint only — see StaffJwtPayload's own comment. */
    staffRole?: StaffAccountRole;
  }
}

// ADR-0023 Decision B2 — the base layer both AdminAuthGuard and PtAuthGuard
// build on. Verifies the `staff_session` cookie's signature (against
// STAFF_JWT_SECRET) and expiry only — deliberately no per-request DB
// lookup at this layer, the identical cheap "signature + expiry only"
// shape ADR-0022 Decision 2 already established for the (never-shipped)
// single-admin cookie this ADR replaces.
@Injectable()
export class StaffAuthGuard implements CanActivate {
  constructor(
    private readonly staffSessionTokenService: StaffSessionTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.cookies?.[STAFF_SESSION_COOKIE_NAME] as
      string | undefined;
    if (!token) {
      throw new StaffUnauthorizedException();
    }

    try {
      const payload = await this.staffSessionTokenService.verify(token);
      request.staffAccountId = payload.sub;
      request.staffRole = payload.role;
    } catch {
      throw new StaffUnauthorizedException(
        'Staff session is invalid or expired.',
      );
    }

    return true;
  }
}
