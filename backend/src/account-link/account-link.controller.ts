import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentPlayerId } from '../auth/current-player-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentStaffAccountId } from '../pt/current-staff-account-id.decorator';
import { StaffAuthGuard } from '../staff-auth/guards/staff-auth.guard';
import { AccountLinkService } from './account-link.service';

/**
 * ADR-0031 — the player half of linking.
 *
 * Every route here identifies the player from the session and nothing
 * else. There is deliberately no route that takes a player id, an email,
 * or a screen name: the design's central rule is that neither identity
 * may name the other, and a convenience parameter here is how that rule
 * would be lost.
 */
@Controller('api/v1/me/account-link')
export class AccountLinkController {
  constructor(private readonly service: AccountLinkService) {}

  /** Whether this player already has a trainer account attached. */
  @UseGuards(JwtAuthGuard)
  @Get()
  status(@CurrentPlayerId() playerId: string): Promise<{ linked: boolean }> {
    return this.service.statusForPlayer(playerId);
  }

  /**
   * Mint the challenge the console will redeem.
   *
   * Throttled tightly: a challenge is cheap to issue and each one is a
   * live ticket for ten minutes, so there is no reason for a legitimate
   * client to ask often, and every reason not to let one accumulate a
   * pile of them.
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @Post('challenge')
  @HttpCode(HttpStatus.CREATED)
  challenge(
    @CurrentPlayerId() playerId: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    return this.service.createChallenge(playerId);
  }

  /** Decision 4 — unilateral, no confirmation, always available. */
  @UseGuards(JwtAuthGuard)
  @Delete()
  @HttpCode(HttpStatus.OK)
  unlink(@CurrentPlayerId() playerId: string): Promise<{ linked: false }> {
    return this.service.unlinkAsPlayer(playerId);
  }
}

/**
 * The trainer half. Guarded by `StaffAuthGuard` alone — deliberately not
 * `AdminAuthGuard` or `PtAuthGuard`, because linking is available to any
 * signed-in staff account and grants nothing that would warrant a
 * stronger gate.
 */
@Controller('api/v1/staff/account-link')
export class StaffAccountLinkController {
  constructor(private readonly service: AccountLinkService) {}

  /**
   * Redeem a challenge. The staff identity comes from the guard; the
   * player identity comes from inside the challenge. The request body
   * carries only the token, so neither side is ever asserted by the
   * caller.
   */
  @UseGuards(StaffAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Post('complete')
  @HttpCode(HttpStatus.OK)
  complete(
    @CurrentStaffAccountId() staffAccountId: string,
    @Body() body: { token?: string },
  ): Promise<{ linked: true }> {
    return this.service.completeLink(staffAccountId, body?.token);
  }

  @UseGuards(StaffAuthGuard)
  @Delete()
  @HttpCode(HttpStatus.OK)
  unlink(
    @CurrentStaffAccountId() staffAccountId: string,
  ): Promise<{ linked: false }> {
    return this.service.unlinkAsStaff(staffAccountId);
  }
}
