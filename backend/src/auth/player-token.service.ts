import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from './jwt-payload.interface';

@Injectable()
export class PlayerTokenService {
  constructor(private readonly jwtService: JwtService) {}

  /**
   * `tokenVersion` is required (not defaulted here) so every call site has
   * to make a conscious choice about which Player row's current version
   * it's issuing against — see ADR-0004 Part 3. A brand-new player shell
   * starts at `0` (Player.token_version's column default); a
   * session-reissue redemption uses whatever the row's incremented value
   * is at that point.
   */
  issueFor(playerId: string, tokenVersion: number): string {
    const payload: JwtPayload = { sub: playerId, tokenVersion };
    return this.jwtService.sign(payload);
  }

  async verify(token: string): Promise<JwtPayload> {
    return this.jwtService.verifyAsync<JwtPayload>(token);
  }
}
