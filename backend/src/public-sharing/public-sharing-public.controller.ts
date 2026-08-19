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
  renderApprovedPage,
  renderDeclinedPage,
  renderInvalidPage,
  renderRevokedPage,
  renderRevokePreviewPage,
  renderReviewPage,
} from './public-sharing-page.templates';
import { PublicSharingConsentService } from './public-sharing-consent.service';

/**
 * ADR-0030's mailed parent links. No auth — a parent has no account and no
 * session; the code in the URL is the credential.
 *
 * **GET previews, POST acts**, and this split is load-bearing rather than
 * stylistic. Mail clients and corporate link scanners prefetch every URL
 * in a message: without it, Outlook Safe Links would grant a child's
 * publication consent with no human ever forming an intent. The consent
 * service documents the same reasoning at `previewByReviewCode`, and
 * ADR-0013 made it a repo convention.
 *
 * Every failure renders the same "link is not valid" page — see
 * renderInvalidPage for why the reason is never disclosed.
 */
@Controller()
export class PublicSharingPublicController {
  constructor(private readonly consent: PublicSharingConsentService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('api/v1/public-sharing/:reviewCode')
  async previewReview(
    @Param('reviewCode') reviewCode: string,
    @Res() res: Response,
  ): Promise<void> {
    const preview = await this.consent.previewByReviewCode(reviewCode);
    const html = preview
      ? renderReviewPage({ screenName: preview.screenName, reviewCode })
      : renderInvalidPage();
    res.status(HttpStatus.OK).type('html').send(html);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('api/v1/public-sharing/:reviewCode/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('reviewCode') reviewCode: string,
    @Res() res: Response,
  ): Promise<void> {
    // The preview runs first purely to recover the screen name for the
    // confirmation page — `approveByReviewCode` returns only `{approved}`,
    // and re-reading afterwards would find a row whose status has moved on.
    const preview = await this.consent.previewByReviewCode(reviewCode);
    const result = await this.consent.approveByReviewCode(reviewCode);
    const html =
      result && preview
        ? renderApprovedPage(preview.screenName)
        : renderInvalidPage();
    res.status(HttpStatus.OK).type('html').send(html);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('api/v1/public-sharing/:reviewCode/decline')
  @HttpCode(HttpStatus.OK)
  async decline(
    @Param('reviewCode') reviewCode: string,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.consent.declineByReviewCode(reviewCode);
    const html = result ? renderDeclinedPage() : renderInvalidPage();
    res.status(HttpStatus.OK).type('html').send(html);
  }

  /**
   * The revoke link is on its own path segment rather than sharing
   * `:reviewCode`'s. Two different credentials with different lifetimes —
   * the review code expires in 14 days, the revoke code never does — must
   * not be reachable through one route, or a spent review code and a live
   * revoke code become interchangeable to anyone probing.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('api/v1/public-sharing/revoke/:revokeCode')
  async previewRevoke(
    @Param('revokeCode') revokeCode: string,
    @Res() res: Response,
  ): Promise<void> {
    const preview = await this.consent.previewByRevokeCode(revokeCode);
    const html = preview
      ? renderRevokePreviewPage({ screenName: preview.screenName, revokeCode })
      : renderInvalidPage();
    res.status(HttpStatus.OK).type('html').send(html);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('api/v1/public-sharing/revoke/:revokeCode')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Param('revokeCode') revokeCode: string,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.consent.revokeByRevokeCode(revokeCode);
    const html = result ? renderRevokedPage() : renderInvalidPage();
    res.status(HttpStatus.OK).type('html').send(html);
  }
}
