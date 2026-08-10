import { Controller, Get, HttpStatus, Param, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { EventRegistrationsService } from './event-registrations.service';
import {
  renderUnsubscribeDone,
  renderUnsubscribeGone,
  renderUnsubscribePreview,
} from './unsubscribe-page.templates';

/**
 * The opt-out link carried in every message to the demo list.
 *
 * Unauthenticated by necessity — the recipient has no account here, and
 * requiring one to stop receiving email would be an obstacle course rather
 * than an opt-out.
 *
 * **GET previews, POST acts** — the same idiom the consent and erasure
 * links use, for the same reason: mail clients and security scanners
 * prefetch URLs in messages, so a GET that deleted the row would
 * unsubscribe people who never clicked, silently.
 *
 * Both responses are HTML, because a human in a mail client is the only
 * caller this will ever have.
 */
@Controller('api/v1/event-registrations/unsubscribe')
export class UnsubscribeController {
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
    // 200 either way, never 404: the status code of an unsubscribe page is
    // not a place to disclose whether a given code is real.
    const html = found
      ? renderUnsubscribePreview(
          found.locale,
          `/api/v1/event-registrations/unsubscribe/${encodeURIComponent(code)}`,
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
    const locale = found?.locale ?? null;
    await this.eventRegistrationsService.unsubscribe(code);
    // "Done" even when nothing was deleted — someone clicking twice, or
    // whose row retention already swept, asked for exactly this outcome
    // and has it. An error would imply their request failed.
    res.status(HttpStatus.OK).type('html').send(renderUnsubscribeDone(locale));
  }
}
