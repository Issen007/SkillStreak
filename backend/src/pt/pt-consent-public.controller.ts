import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  renderPtConsentApprovedPage,
  renderPtConsentDeclinedPage,
  renderPtConsentInvalidPage,
  renderPtConsentRevokedPage,
  renderPtConsentRevokeInvalidPage,
  renderPtConsentRevokePreviewPage,
  renderPtConsentReviewPage,
} from './pt-consent-page.templates';
import { PtConsentService } from './pt-consent.service';

// docs/adr/0023-pt-role-and-staff-sso-rbac.md Decision A3's mailed
// review-and-approve endpoints, and Decision A4 point 2's non-expiring
// revoke link — no auth (a parent/self-verifying player has no staff or
// player session token for this), the code in the URL is the credential.
// Same GET-preview/POST-action split as ConsentController/
// AccountErasureController's mailed-link routes: GET has zero side
// effects (email clients/security scanners prefetch links), only POST
// (the page's own button) performs the actual approve/decline/revoke.
@Controller()
export class PtConsentPublicController {
  constructor(private readonly ptConsentService: PtConsentService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('api/v1/pt-consent/:reviewCode')
  async previewReview(
    @Param('reviewCode') reviewCode: string,
    @Res() res: Response,
  ): Promise<void> {
    const preview = await this.ptConsentService.previewByReviewCode(reviewCode);
    const html = preview
      ? renderPtConsentReviewPage(preview)
      : renderPtConsentInvalidPage();
    res.status(HttpStatus.OK).type('html').send(html);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('api/v1/pt-consent/:reviewCode/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('reviewCode') reviewCode: string,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.ptConsentService.approveByReviewCode(reviewCode);
    const html = result
      ? renderPtConsentApprovedPage(result.ptDisplayName)
      : renderPtConsentInvalidPage();
    res.status(HttpStatus.OK).type('html').send(html);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('api/v1/pt-consent/:reviewCode/decline')
  @HttpCode(HttpStatus.OK)
  async decline(
    @Param('reviewCode') reviewCode: string,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.ptConsentService.declineByReviewCode(reviewCode);
    const html = result
      ? renderPtConsentDeclinedPage()
      : renderPtConsentInvalidPage();
    res.status(HttpStatus.OK).type('html').send(html);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('api/v1/pt-consent-revoke/:revokeCode')
  async previewRevoke(
    @Param('revokeCode') revokeCode: string,
    @Res() res: Response,
  ): Promise<void> {
    const preview = await this.ptConsentService.previewByRevokeCode(revokeCode);
    const html = preview
      ? renderPtConsentRevokePreviewPage(preview)
      : renderPtConsentRevokeInvalidPage();
    res.status(HttpStatus.OK).type('html').send(html);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('api/v1/pt-consent-revoke/:revokeCode')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Param('revokeCode') revokeCode: string,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.ptConsentService.revokeByRevokeCode(revokeCode);
    const html = result
      ? renderPtConsentRevokedPage()
      : renderPtConsentRevokeInvalidPage();
    res.status(HttpStatus.OK).type('html').send(html);
  }
}
