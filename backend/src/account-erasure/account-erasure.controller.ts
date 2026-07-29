import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentPlayerId } from '../auth/current-player-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  AccountErasureService,
  ErasureStatusResponse,
  RequestErasureResponse,
} from './account-erasure.service';
import { RequestErasureDto } from './dto/request-erasure.dto';
import {
  renderErasureCancelInvalidPage,
  renderErasureCancelledPage,
  renderErasureCancelPreviewPage,
} from './erasure-cancel-page.templates';
import {
  renderErasureConfirmedPage,
  renderErasureConfirmInvalidPage,
  renderErasureConfirmPreviewPage,
} from './erasure-confirm-page.templates';

// docs/adr/0013-account-erasure.md Decision 3. Guards are per-method, not
// class-level, same reasoning as ProfileController: the JSON routes
// (app-facing, `/me/...`) require auth; the confirm/cancel-link routes
// (browser-facing HTML, reached by clicking a link in a mailed email)
// deliberately don't — see AccountErasureService's class comment for why
// that's load-bearing here, not just convenience.
@Controller('api/v1/players')
export class AccountErasureController {
  constructor(private readonly accountErasureService: AccountErasureService) {}

  // 201, not 200 — this creates a new AccountErasureRequest row, same
  // resource-creation posture as POST /players (OnboardingController),
  // not a plain state-mutation like ProfileService's contact-change
  // routes.
  @Post('me/erasure/request')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  requestErasure(
    @CurrentPlayerId() playerId: string,
    @Body() dto: RequestErasureDto,
  ): Promise<RequestErasureResponse> {
    return this.accountErasureService.requestErasure(
      playerId,
      dto.successorPlayerId,
    );
  }

  @Get('me/erasure/status')
  @UseGuards(JwtAuthGuard)
  getStatus(
    @CurrentPlayerId() playerId: string,
  ): Promise<ErasureStatusResponse> {
    return this.accountErasureService.getStatus(playerId);
  }

  // The authenticated, PRIMARY cancel path (Decision 7) — the account
  // stays fully live during the whole grace period, so an in-app button is
  // the obvious low-friction route.
  @Post('me/erasure/cancel')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentPlayerId() playerId: string): Promise<{ cancelled: true }> {
    return this.accountErasureService.cancel(playerId);
  }

  // The mailed confirm link — no auth (a bare in-app tap only creates the
  // request; this is the step that actually starts the 30-day clock, see
  // Decision 2). No side effects on GET (email clients/security scanners
  // prefetch links) — same `@Throttle` posture as ConsentController/
  // ProfileController's analogous unauthenticated link routes.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('erasure-confirm/:code')
  async previewConfirm(
    @Param('code') code: string,
    @Res() res: Response,
  ): Promise<void> {
    const preview = await this.accountErasureService.previewConfirm(code);
    const html = preview
      ? renderErasureConfirmPreviewPage(preview.screenName)
      : renderErasureConfirmInvalidPage();
    res.status(HttpStatus.OK).type('html').send(html);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('erasure-confirm/:code')
  async confirmErasure(
    @Param('code') code: string,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.accountErasureService.confirmErasure(code);
    const html = result
      ? renderErasureConfirmedPage(result.scheduledFor.slice(0, 10))
      : renderErasureConfirmInvalidPage();
    res.status(HttpStatus.OK).type('html').send(html);
  }

  // The mailed cancel link — a backup for "I don't have my session/this is
  // a new phone," not the primary route (see cancel() above).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('erasure-cancel/:code')
  async previewCancel(
    @Param('code') code: string,
    @Res() res: Response,
  ): Promise<void> {
    const preview = await this.accountErasureService.previewCancel(code);
    const html = preview
      ? renderErasureCancelPreviewPage(preview.screenName)
      : renderErasureCancelInvalidPage();
    res.status(HttpStatus.OK).type('html').send(html);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('erasure-cancel/:code')
  async cancelByCode(
    @Param('code') code: string,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.accountErasureService.cancelByCode(code);
    const html = result
      ? renderErasureCancelledPage()
      : renderErasureCancelInvalidPage();
    res.status(HttpStatus.OK).type('html').send(html);
  }
}
