import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { StaffAuthProvider } from './entities/staff-account.entity';

// ADR-0023 Decision B6 (required, per security-reviewer's Part B pass,
// Finding 3 — see the ADR's Status): `state`/PKCE (`code_verifier`/
// `code_challenge`)/`nonce` must be generated, held server-side tied to
// the pre-authentication request, and verified on callback, for all three
// providers.
//
// "Held server-side" here means a short-lived, signed, httpOnly cookie
// (`staff_auth_pending`) — not a server-side session store this app
// otherwise has no use for. Signed with the same STAFF_JWT_SECRET as the
// real `staff_session` cookie (a different JwtService *call* — a 10-minute
// expiresIn override, not the module's registered 24h default — so a
// stale/replayed pending-auth cookie can't be presented long after the
// login attempt it belongs to).
export interface PendingStaffAuthPayload {
  provider: StaffAuthProvider;
  state: string;
  nonce: string;
  codeVerifier: string;
}

const PENDING_AUTH_TTL = '10m';

@Injectable()
export class PendingStaffAuthService {
  constructor(private readonly jwtService: JwtService) {}

  sign(payload: PendingStaffAuthPayload): string {
    return this.jwtService.sign(payload, { expiresIn: PENDING_AUTH_TTL });
  }

  async verify(token: string): Promise<PendingStaffAuthPayload> {
    return this.jwtService.verifyAsync<PendingStaffAuthPayload>(token);
  }
}
