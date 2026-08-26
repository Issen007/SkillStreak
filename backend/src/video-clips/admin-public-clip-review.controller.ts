import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentStaffAccountId } from '../pt/current-staff-account-id.decorator';
import { AdminAuthGuard } from '../staff-auth/guards/admin-auth.guard';
import { ObjectStorageService } from './object-storage.service';
import {
  AdminPublicClipReviewService,
  type PublicClipReviewItem,
} from './admin-public-clip-review.service';
import { RejectPublicClipDto } from './dto/reject-public-clip.dto';
import { CLIP_PLAYBACK_URL_EXPIRES_SECONDS } from './video-clip.constants';

/**
 * docs/design/clip-safety.md layer 3 — a person watches a clip before any
 * stranger can.
 *
 * Admin only, never PT. A trainer reviewing children's video from teams
 * that did not invite them would hand every trainer a cross-team window
 * into children's media, which is the closed-team-bubble rule inverted —
 * and the review queue is app-wide by nature. This is the operator's job
 * precisely because there is exactly one of them.
 *
 * The scaling limit is real and is written down in the design doc rather
 * than discovered: one operator does not scale, and this is the first
 * thing to revisit if public sharing succeeds.
 */
@Controller('api/v1/admin/public-clips')
@UseGuards(AdminAuthGuard)
export class AdminPublicClipReviewController {
  constructor(
    private readonly review: AdminPublicClipReviewService,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  /**
   * The queue. Playback URLs are minted per request and expire, exactly
   * as every other clip surface does — reviewing a video requires
   * watching it, and there is no durable URL anywhere in this app.
   */
  @Get('pending')
  listPending(): Promise<PublicClipReviewItem[]> {
    return this.review.listPending((storageKey) =>
      this.objectStorage.createPresignedGetUrl(
        storageKey,
        CLIP_PLAYBACK_URL_EXPIRES_SECONDS,
      ),
    );
  }

  @Post(':clipId/approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  approve(
    @CurrentStaffAccountId() staffAccountId: string,
    @Param('clipId') clipId: string,
  ): Promise<void> {
    return this.review.approve(clipId, staffAccountId);
  }

  /**
   * A reason is required, not optional.
   *
   * The uploader is a child whose clip is being refused, and "no" without
   * a reason is the version of this that makes a nine-year-old think they
   * did something wrong when they may not have.
   */
  @Post(':clipId/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  reject(
    @CurrentStaffAccountId() staffAccountId: string,
    @Param('clipId') clipId: string,
    @Body() dto: RejectPublicClipDto,
  ): Promise<void> {
    return this.review.reject(clipId, staffAccountId, dto.reason);
  }
}
