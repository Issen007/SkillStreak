import {
  BadRequestException,
  Body,
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
  PublicFeedItem,
  PublicFeedPage,
  PublicFeedService,
} from '../video-clips/public-feed.service';
import {
  ClipReactionsService,
  ReactionTotals,
  ViewerReactionResult,
} from '../video-clips/clip-reactions.service';
import { ReactToClipDto } from './dto/react-to-clip.dto';
import { ReportPublicClipDto } from './dto/report-public-clip.dto';
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
    private readonly reactions: ClipReactionsService,
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
    const page = await this.feed.list(playerId, cursor);

    // The viewer's own reaction state, merged here rather than inside
    // PublicFeedService — the reactions service depends on the feed's
    // visibility gate, so having the feed depend back on it would cycle.
    // One query for the page, not one per card.
    const mine = await this.reactions.viewerReactionsFor(
      playerId,
      page.items.map((item) => item.clipId),
    );
    return {
      ...page,
      items: page.items.map((item) => ({
        ...item,
        // `myReaction` and nothing else. There is no total on a feed card
        // by design — see ClipReactionsService's class doc for why that
        // asymmetry is the product decision rather than an omission.
        myReaction: mine.get(item.clipId) ?? null,
      })),
    };
  }

  /**
   * Set, change or toggle off the viewer's reaction to a public clip.
   *
   * One endpoint for all three, because from the child's side they are
   * one gesture: tapping a different reaction replaces, tapping the same
   * one clears. The client sends what was tapped and the service decides
   * what that means.
   *
   * Throttled per the same posture as the rest of this controller. A
   * reaction is cheap and idempotent — the UNIQUE index means a double
   * tap cannot inflate anything — so this bounds abuse of the write path
   * rather than protecting a count.
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('api/v1/public-feed/:clipId/reaction')
  @HttpCode(HttpStatus.OK)
  async react(
    @CurrentPlayerId() playerId: string,
    @Param('clipId') clipId: string,
    @Body() dto: ReactToClipDto,
  ): Promise<ViewerReactionResult> {
    return this.reactions.react(playerId, clipId, dto.reaction);
  }

  /** Withdraw a reaction explicitly. Idempotent; clearing nothing is fine. */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Delete('api/v1/public-feed/:clipId/reaction')
  @HttpCode(HttpStatus.OK)
  async clearReaction(
    @CurrentPlayerId() playerId: string,
    @Param('clipId') clipId: string,
  ): Promise<ViewerReactionResult> {
    return this.reactions.clear(playerId, clipId);
  }

  /** Save a public clip to Sparade. */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('api/v1/public-feed/:clipId/save')
  @HttpCode(HttpStatus.OK)
  async saveClip(
    @CurrentPlayerId() playerId: string,
    @Param('clipId') clipId: string,
  ): Promise<{ clipId: string; saved: true }> {
    return this.feed.saveBookmark(playerId, clipId);
  }

  /** Remove it again. Idempotent, and never gated on visibility. */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Delete('api/v1/public-feed/:clipId/save')
  @HttpCode(HttpStatus.OK)
  async unsaveClip(
    @CurrentPlayerId() playerId: string,
    @Param('clipId') clipId: string,
  ): Promise<{ clipId: string; saved: false }> {
    return this.feed.removeBookmark(playerId, clipId);
  }

  /**
   * Screen A1's Sparade collection.
   *
   * Re-validated server-side on every call — see `listSaved` for why a
   * stored bookmark must never be rendered from. `missingCount` lets the
   * UI say something is gone without saying which.
   */
  @UseGuards(JwtAuthGuard)
  @Get('api/v1/me/saved-clips')
  async savedClips(
    @CurrentPlayerId() playerId: string,
  ): Promise<{ items: PublicFeedItem[]; missingCount: number }> {
    return this.feed.listSaved(playerId);
  }

  /**
   * Screen F3 — report a public clip.
   *
   * Throttled hard. A report auto-revokes public visibility, so the
   * cheapest possible denial-of-service against another child's clip is
   * a script that reports everything it can see; the per-viewer-per-clip
   * uniqueness bounds the damage per clip and this bounds the rate
   * across them.
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @Post('api/v1/public-feed/:clipId/report')
  @HttpCode(HttpStatus.OK)
  async reportPublic(
    @CurrentPlayerId() playerId: string,
    @Param('clipId') clipId: string,
    @Body() dto: ReportPublicClipDto,
  ): Promise<{ clipId: string; reported: true }> {
    return this.feed.reportPublicClip(playerId, clipId, dto.reason);
  }

  /**
   * Reaction totals for one clip — **the uploader's own only**.
   *
   * This is the Archive's number, and the ownership check inside the
   * service is what keeps it from being the public-count endpoint the
   * design argues against.
   */
  @UseGuards(JwtAuthGuard)
  @Get('api/v1/me/clips/:clipId/reactions')
  async myClipReactions(
    @CurrentPlayerId() playerId: string,
    @Param('clipId') clipId: string,
  ): Promise<ReactionTotals> {
    return this.reactions.totalsForOwnClip(playerId, clipId);
  }

  private async isAvailableFor(playerId: string): Promise<boolean> {
    const player = await this.players.findOne({
      where: { id: playerId },
      select: { teamId: true },
    });
    return this.access.isEnabledForTeam(player?.teamId);
  }
}
