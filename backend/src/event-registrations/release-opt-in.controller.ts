import { Controller, Get, HttpStatus, Param, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { EventRegistrationsService } from './event-registrations.service';
import {
  renderReleaseOptInDone,
  renderReleaseOptInPreview,
  renderUnsubscribeGone,
} from './unsubscribe-page.templates';

/**
 * "Yes, also tell me about new releases" — the link in the one-off
 * re-consent email.
 *
 * Everyone on this list before 2026-08-21 signed up for a demo invitation
 * under a consent line that said the address would be used for that and
 * nothing else. The form now offers release news as a separate opt-in;
 * these people never saw that box. Rather than reinterpret their old
 * consent as covering the new mail, they are asked once, and only the
 * ones who press this button are added.
 *
 * **Keyed by the same per-row code the unsubscribe link uses.** It is
 * already unguessable, already unique per person, and already mailed only
 * to the address it belongs to, so a second credential would add a column
 * without adding a guarantee. The routes stay separate, though — a code
 * that opts you in and a code that deletes you must never be reachable
 * through one path, or a mistyped URL becomes the wrong verb.
 *
 * **GET previews, POST acts** (ADR-0013). It matters more here than on the
 * unsubscribe page: a mail scanner prefetching this URL would manufacture
 * a marketing consent that no human ever gave, which is precisely the
 * thing the whole re-consent exercise exists to avoid.
 */
@Controller('api/v1/event-registrations/release-updates')
export class ReleaseOptInController {
  constructor(
    private readonly eventRegistrationsService: EventRegistrationsService,
  ) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':code')
  async preview(
    @Param('code') code: string,
    @Res() res: Response,
  ): Promise<void> {
    const found =
      await this.eventRegistrationsService.findByUnsubscribeCode(code);
    // 200 either way — the status code of a mailed link is not a place to
    // disclose whether a given code is real.
    const html = found
      ? renderReleaseOptInPreview(
          found.locale,
          `/api/v1/event-registrations/release-updates/${encodeURIComponent(code)}`,
        )
      : renderUnsubscribeGone(null);
    res.status(HttpStatus.OK).type('html').send(html);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':code')
  async confirm(
    @Param('code') code: string,
    @Res() res: Response,
  ): Promise<void> {
    const found =
      await this.eventRegistrationsService.findByUnsubscribeCode(code);
    if (!found) {
      res.status(HttpStatus.OK).type('html').send(renderUnsubscribeGone(null));
      return;
    }
    await this.eventRegistrationsService.optInToReleaseUpdates(code);
    // "Done" even for a second click: they asked for exactly this outcome
    // and have it, and the service keeps the first consent's date.
    res
      .status(HttpStatus.OK)
      .type('html')
      .send(renderReleaseOptInDone(found.locale));
  }
}
