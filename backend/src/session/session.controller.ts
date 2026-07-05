import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SessionReissueDisabledException } from '../common/errors/exceptions';
import {
  SessionRedeemResponse,
  SessionReissueResponse,
} from './session.service';

// Both routes below are DISABLED — see SessionReissueDisabledException's
// comment for why (a confirmed security-review finding: the reissue code
// is redeemable by whoever calls reissue, not bound to the target player,
// so a captain can impersonate any teammate at will). SessionService and
// its tests are left intact — the mechanism itself is sound once
// redemption is properly bound to the target, this is a routing-layer
// gate pending that redesign, not a rewrite of the underlying logic. Kept
// as real routes (not deleted/404) so the response is a clear, honest 503
// rather than "this endpoint doesn't exist".
@Controller('api/v1/players')
export class SessionController {
  // Captain-only (service-layer check against the *target* player's team —
  // see SessionService.triggerReissue), authenticated via the requester's
  // ordinary player JWT. No CoachAuthGuard — that entire concept is
  // superseded, see ADR-0004's 2026-07-05 addendum.
  @UseGuards(JwtAuthGuard)
  @Post(':playerId/session-reissue')
  @HttpCode(HttpStatus.OK)
  reissue(): Promise<SessionReissueResponse> {
    throw new SessionReissueDisabledException();
  }

  // No auth — the kid redeeming a code has, by definition, no valid
  // session token (that's the whole point of this endpoint), same
  // unauthenticated-by-necessity category as POST /players. Throttled
  // per-IP as defense-in-depth (the code's own entropy/TTL is the real
  // protection, per ADR-0004 Part 3).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('session/redeem')
  @HttpCode(HttpStatus.OK)
  redeem(): Promise<SessionRedeemResponse> {
    throw new SessionReissueDisabledException();
  }
}
