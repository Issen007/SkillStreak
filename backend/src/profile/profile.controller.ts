import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentPlayerId } from '../auth/current-player-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  renderCancelAppliedPage,
  renderCancelConfirmPage,
  renderCancelInvalidPage,
} from './contact-change-cancel-page.templates';
import { ConfirmContactChangeDto } from './dto/confirm-contact-change.dto';
import { RequestContactChangeDto } from './dto/request-contact-change.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  ConfirmContactChangeResponse,
  PlayerProfile,
  ProfileService,
  RequestContactChangeResponse,
} from './profile.service';

// docs/adr/0012-profile-page-and-contact-email-change.md. Guards are
// per-method, not class-level: the JSON routes (app-facing, `/me/...`)
// require auth; the cancel-link routes (browser-facing HTML, reached by
// clicking a link in the OLD address's email) deliberately don't — the
// whole point is that address might not want to rely on whatever session
// is currently live on the account. Same "GET has no side effects, only
// POST acts" split as ConsentController, for the same email-prefetch-
// safety reason.
@Controller('api/v1/players')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get('me/profile')
  @UseGuards(JwtAuthGuard)
  getProfile(@CurrentPlayerId() playerId: string): Promise<PlayerProfile> {
    return this.profileService.getProfile(playerId);
  }

  @Patch('me/profile')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async updateProfile(
    @CurrentPlayerId() playerId: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<{ updated: true }> {
    // realName/avatarId undefined (omitted from the request body) means
    // "leave unchanged" — birth year has no update path at all, per
    // decision 2. Each field is an explicit check rather than always
    // calling through, so a future third field doesn't silently inherit
    // this "only if present" behavior by accident.
    if (dto.realName !== undefined) {
      await this.profileService.updateRealName(playerId, dto.realName);
    }
    if (dto.avatarId !== undefined) {
      await this.profileService.updateAvatarId(playerId, dto.avatarId);
    }
    return { updated: true };
  }

  @Post('me/contact-change-request')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  requestContactChange(
    @CurrentPlayerId() playerId: string,
    @Body() dto: RequestContactChangeDto,
  ): Promise<RequestContactChangeResponse> {
    return this.profileService.requestContactChange(playerId, dto.newContact);
  }

  @Post('me/contact-change-confirm')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  confirmContactChange(
    @CurrentPlayerId() playerId: string,
    @Body() dto: ConfirmContactChangeDto,
  ): Promise<ConfirmContactChangeResponse> {
    return this.profileService.confirmContactChange(playerId, dto.code);
  }

  // The OLD address's cancel link — no auth, HTML not JSON, same
  // no-side-effects-on-GET requirement as ConsentController.previewConsent
  // (email clients/security scanners prefetch links).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('contact-change-cancel/:code')
  async previewCancelContactChange(
    @Param('code') code: string,
    @Res() res: Response,
  ): Promise<void> {
    const preview = await this.profileService.previewCancelContactChange(code);
    const html = preview
      ? renderCancelConfirmPage(preview.screenName)
      : renderCancelInvalidPage();
    res.status(HttpStatus.OK).type('html').send(html);
  }

  // The genuine cancel step: the GET page's button POSTs here.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('contact-change-cancel/:code')
  @HttpCode(HttpStatus.OK)
  async cancelContactChange(
    @Param('code') code: string,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.profileService.cancelContactChange(code);
    // A second POST to an already-consumed code is an expected case (a
    // double-tap, or the flow exercised twice) — same friendly-page
    // idiom as ConsentController.approveConsent, not an error.
    const html = result ? renderCancelAppliedPage() : renderCancelInvalidPage();
    res.status(HttpStatus.OK).type('html').send(html);
  }
}
