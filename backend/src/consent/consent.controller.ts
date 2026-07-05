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
  renderConsentAlreadyUsedPage,
  renderConsentApprovedPage,
  renderConsentConfirmPage,
  renderConsentInvalidPage,
} from './consent-page.templates';
import { ConsentService } from './consent.service';

// The parent-facing web link from docs/api/phase1-contract.md step 6 —
// GET/POST /api/v1/consent/:consentToken. Not part of the Expo app's
// contract: this is HTML for a parent's phone/browser, not JSON for the
// app. No auth (a parent has no session token) — the 256-bit token in the
// URL itself is the credential, per docs/adr/0002 addendum's task notes.
@Controller('api/v1/consent')
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  // Deliberately has NO side effects. Email clients and security scanners
  // routinely prefetch links found in emails — if this GET performed the
  // approval, consent could be auto-granted without any human ever
  // clicking anything. The actual approval only happens on POST, below,
  // which this page's button triggers.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get(':token')
  async previewConsent(
    @Param('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    const preview = await this.consentService.previewByToken(token);
    const html = preview
      ? renderConsentConfirmPage(preview.screenName)
      : renderConsentInvalidPage();
    res.status(HttpStatus.OK).type('html').send(html);
  }

  // The genuine confirmation step: the GET page's button POSTs here.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':token')
  @HttpCode(HttpStatus.OK)
  async approveConsent(
    @Param('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.consentService.approve(token);
    // A second POST to an already-consumed token is an expected case (a
    // parent double-tapping the button, or the flow being exercised twice
    // for testing) — rendered as a friendly "already confirmed" page, not
    // an error, per the task's idempotent-feeling requirement.
    const html = result
      ? renderConsentApprovedPage(result.screenName)
      : renderConsentAlreadyUsedPage();
    res.status(HttpStatus.OK).type('html').send(html);
  }
}
