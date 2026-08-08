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
  /**
   * True when this flow was started by ADR-0022 Decision 10's step-up
   * re-auth rather than an ordinary sign-in. Carried here — inside the
   * signed cookie, not a query parameter — precisely so the callback
   * cannot be tricked into treating an ordinary login as a step-up: the
   * caller never gets to assert it. See StaffAuthService.completeLogin
   * for the `auth_time` check this flag turns on.
   */
  stepUp?: boolean;
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
