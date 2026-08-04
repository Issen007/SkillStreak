import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { StaffAccountRole } from './entities/staff-account.entity';
import { StaffJwtPayload } from './staff-jwt-payload.interface';

// The `staff_session` cookie's contents (ADR-0023 Decision B2) — signed
// with STAFF_JWT_SECRET, a secret wholly independent of the player
// JWT_SECRET (see AuthModule's own reasoning, reused verbatim: signature
// verification fails outright across that boundary, before any claim is
// even inspected). Lifetime (24h) comes from this service's own
// JwtModule registration in StaffAuthModule, not overridden per call.
@Injectable()
export class StaffSessionTokenService {
  constructor(private readonly jwtService: JwtService) {}

  issueFor(staffAccountId: string, role: StaffAccountRole): string {
    const payload: StaffJwtPayload = { sub: staffAccountId, role };
    return this.jwtService.sign(payload);
  }

  async verify(token: string): Promise<StaffJwtPayload> {
    return this.jwtService.verifyAsync<StaffJwtPayload>(token);
  }
}
