import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentPlayerId } from '../auth/current-player-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RedeemSessionDto } from './dto/redeem-session.dto';
import {
  SessionRedeemResponse,
  SessionReissueResponse,
  SessionService,
} from './session.service';

@Controller('api/v1/players')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  // Captain-only (service-layer check against the *target* player's team —
  // see SessionService.triggerReissue), authenticated via the requester's
  // ordinary player JWT. No CoachAuthGuard — that entire concept is
  // superseded, see ADR-0004's 2026-07-05 addendum.
  @UseGuards(JwtAuthGuard)
  @Post(':playerId/session-reissue')
  @HttpCode(HttpStatus.OK)
  async reissue(
    @CurrentPlayerId() requesterId: string,
    @Param('playerId') playerId: string,
  ): Promise<SessionReissueResponse> {
    return this.sessionService.triggerReissue(requesterId, playerId);
  }

  // No auth — the kid redeeming a code has, by definition, no valid
  // session token (that's the whole point of this endpoint), same
  // unauthenticated-by-necessity category as POST /players. Throttled
  // per-IP as defense-in-depth (the code's own entropy/TTL is the real
  // protection, per ADR-0004 Part 3).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('session/redeem')
  @HttpCode(HttpStatus.OK)
  async redeem(@Body() dto: RedeemSessionDto): Promise<SessionRedeemResponse> {
    return this.sessionService.redeem(dto.code);
  }
}
