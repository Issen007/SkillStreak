import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Throttle } from '@nestjs/throttler';
import { Repository } from 'typeorm';
import { CurrentPlayerId } from '../auth/current-player-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Player } from '../players/entities/player.entity';
import {
  PublicFeedPage,
  PublicFeedService,
} from '../video-clips/public-feed.service';
import { PublicSharingAccessService } from './public-sharing-access.service';
import { PublicSharingConsentService } from './public-sharing-consent.service';

export interface PublicSharingStatus {
  /**
   * Whether the feature exists for this player's team at all — the
   * allow-list. False means the app should not show a share button,
   * rather than show one that always fails.
   */
  available: boolean;
  /** Whether the child may publish right now. */
  canShare: boolean;
  /** Drives which of the three states the app renders. */
  consent: 'none' | 'pending' | 'active';
}

/**
 * The player's own half of ADR-0030 — everything the app calls with a
 * session token.
 *
 * **Path prefix `api/v1/me/public-sharing`, deliberately not
 * `api/v1/public-sharing`.** The parent pages own that second prefix with
 * a `:reviewCode` wildcard, and a sibling route under it would be
 * shadowed by — or would shadow — a mailed consent link depending on
 * registration order. Two audiences with two credential types get two
 * prefixes rather than one prefix and a comment asking people to be
 * careful.
 */
@Controller()
export class PublicSharingController {
  constructor(
    private readonly consent: PublicSharingConsentService,
    private readonly access: PublicSharingAccessService,
    private readonly feed: PublicFeedService,
    @InjectRepository(Player)
    private readonly players: Repository<Player>,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('api/v1/me/public-sharing')
  async status(
    @CurrentPlayerId() playerId: string,
  ): Promise<PublicSharingStatus> {
    const available = await this.isAvailableFor(playerId);
    const consent = await this.consent.statusFor(playerId);
    return {
      available,
      // Both gates, resolved server-side into one boolean. The app should
      // not be reimplementing "allow-listed AND consented" — that is the
      // rule this feature turns on, and it belongs in one place.
      canShare: available && consent === 'active',
      consent,
    };
  }

  /**
   * The child asks for their parent to be emailed.
   *
   * Rate limited hard on top of the service's own 15-minute cooldown and
   * 3-per-day cap: this endpoint causes mail to be sent to an address the
   * caller does not control and cannot see, which is the shape of every
   * mail-relay abuse.
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @Post('api/v1/me/public-sharing/request')
  @HttpCode(HttpStatus.OK)
  async request(
    @CurrentPlayerId() playerId: string,
  ): Promise<{ requested: true; expiresAt: Date }> {
    if (!(await this.isAvailableFor(playerId))) {
      // Refused before any mail is sent. Emailing a parent to approve a
      // feature their child's team cannot use would be asking for consent
      // to nothing, and would be the app's own doing rather than theirs.
      throw new BadRequestException(
        'Public sharing is not available for this team.',
      );
    }
    try {
      return await this.consent.request(playerId);
    } catch (error) {
      // The service throws a plain Error for "already active" and for the
      // pending-contact-change window. Both are the caller's state rather
      // than a server fault, so neither should surface as a 500 — and the
      // message is not echoed back, since it describes internal rules.
      throw new BadRequestException(
        error instanceof Error && error.message.includes('already active')
          ? 'Sharing is already switched on for this account.'
          : 'Sharing cannot be requested right now.',
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('api/v1/clips/:clipId/public')
  @HttpCode(HttpStatus.OK)
  async publish(
    @CurrentPlayerId() playerId: string,
    @Param('clipId') clipId: string,
  ) {
    return this.feed.publish(playerId, clipId);
  }

  /**
   * DELETE, and it carries no preconditions beyond ownership — see
   * `PublicFeedService.unpublish` for why taking a clip down must never
   * be gated on the same things putting it up is gated on.
   */
  @UseGuards(JwtAuthGuard)
  @Delete('api/v1/clips/:clipId/public')
  @HttpCode(HttpStatus.OK)
  async unpublish(
    @CurrentPlayerId() playerId: string,
    @Param('clipId') clipId: string,
  ) {
    return this.feed.unpublish(playerId, clipId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('api/v1/public-feed')
  async list(
    @CurrentPlayerId() playerId: string,
    @Query('cursor') cursor?: string,
  ): Promise<PublicFeedPage> {
    return this.feed.list(playerId, cursor);
  }

  private async isAvailableFor(playerId: string): Promise<boolean> {
    const player = await this.players.findOne({
      where: { id: playerId },
      select: { teamId: true },
    });
    return this.access.isEnabledForTeam(player?.teamId);
  }
}
