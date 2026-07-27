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
import { RequestSessionReissueDto } from './dto/request-session-reissue.dto';
import {
  SessionRedeemResponse,
  SessionReissueSelfServiceResponse,
  SessionReissueTriggerResponse,
  SessionService,
} from './session.service';

// docs/adr/0004-coach-auth-and-session-reissue.md Part 3, redesigned per
// its 2026-07-27 addendum. Both routes below returned/redeemed the
// reissue code without binding it to the target player from 2026-07-05
// until this redesign, which is why they were disabled in between — see
// the ADR addendum for the full history.
@Controller('api/v1/players')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  // Captain-only (service-layer check against the *target* player's team —
  // see SessionService.triggerReissue), authenticated via the requester's
  // ordinary player JWT. No CoachAuthGuard — that entire concept is
  // superseded, see ADR-0004's 2026-07-05 addendum. Response never
  // contains the code itself (see SessionService.performReissue).
  @UseGuards(JwtAuthGuard)
  @Post(':playerId/session-reissue')
  @HttpCode(HttpStatus.OK)
  reissue(
    @Param('playerId') playerId: string,
    @CurrentPlayerId() requesterId: string,
  ): Promise<SessionReissueTriggerResponse> {
    return this.sessionService.triggerReissue(requesterId, playerId);
  }

  // No auth — a player with no valid session, by definition, can't
  // authenticate to ask for this. Same unauthenticated-by-necessity
  // category as POST /players; identical per-IP throttle to that route
  // (volume-level defense-in-depth against enumeration/harassment — the
  // real protection is the code being emailed to parent_contact, not
  // returned here, and the per-player cooldown inside SessionService).
  // Always returns the same generic response, matched by
  // requestReissueSelfService itself — see its own comment.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('session/reissue-request')
  @HttpCode(HttpStatus.OK)
  reissueRequest(
    @Body() dto: RequestSessionReissueDto,
  ): Promise<SessionReissueSelfServiceResponse> {
    return this.sessionService.requestReissueSelfService(
      dto.inviteCode,
      dto.screenName,
    );
  }

  // No auth — the kid redeeming a code has, by definition, no valid
  // session token (that's the whole point of this endpoint), same
  // unauthenticated-by-necessity category as POST /players. Throttled
  // per-IP as defense-in-depth (the code's own entropy/TTL is the real
  // protection, per ADR-0004 Part 3).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('session/redeem')
  @HttpCode(HttpStatus.OK)
  redeem(@Body() dto: RedeemSessionDto): Promise<SessionRedeemResponse> {
    return this.sessionService.redeem(dto.code);
  }
}
