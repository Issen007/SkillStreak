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
import {
  AdminClipModerationService,
  type ReportedClipItem,
} from './admin-clip-moderation.service';
import { ClipModerationDecisionDto } from './dto/clip-moderation-decision.dto';
import { ObjectStorageService } from './object-storage.service';
import { CLIP_PLAYBACK_URL_EXPIRES_SECONDS } from './video-clip.constants';

/**
 * docs/design/clip-safety.md layer 4 — the back half of report-and-take-down.
 *
 * Admin only, for the same reason the public-clip queue is: a trainer
 * ruling on children's video from teams that never invited them would
 * invert the closed-team-bubble rule, and reports arrive from every team.
 *
 * The queue never names a reporter. `clip_report`'s anonymity guarantee
 * is that no response returns one to any player, and while an operator is
 * not a player, exposing it here would put it one careless join from a
 * screen — and would change what reporting costs a child afraid of the
 * person they are reporting.
 */
@Controller('api/v1/admin/reported-clips')
@UseGuards(AdminAuthGuard)
export class AdminClipModerationController {
  constructor(
    private readonly moderation: AdminClipModerationService,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  @Get('pending')
  listPending(): Promise<ReportedClipItem[]> {
    return this.moderation.listPending((storageKey) =>
      this.objectStorage.createPresignedGetUrl(
        storageKey,
        CLIP_PLAYBACK_URL_EXPIRES_SECONDS,
      ),
    );
  }

  /** The report was right — it stays hidden, and that is now on record. */
  @Post(':clipId/uphold')
  @HttpCode(HttpStatus.NO_CONTENT)
  uphold(
    @CurrentStaffAccountId() staffAccountId: string,
    @Param('clipId') clipId: string,
    @Body() dto: ClipModerationDecisionDto,
  ): Promise<void> {
    return this.moderation.uphold(clipId, staffAccountId, dto.note);
  }

  /**
   * Put it back.
   *
   * The capability whose absence made a report a one-way door: any
   * teammate could remove another child's clip permanently, for any
   * reason or none, and nobody could undo it.
   */
  @Post(':clipId/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  dismiss(
    @CurrentStaffAccountId() staffAccountId: string,
    @Param('clipId') clipId: string,
    @Body() dto: ClipModerationDecisionDto,
  ): Promise<void> {
    return this.moderation.dismiss(clipId, staffAccountId, dto.note);
  }
}
