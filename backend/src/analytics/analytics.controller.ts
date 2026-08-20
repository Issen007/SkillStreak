import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AnalyticsService } from './analytics.service';
import { RecordClickDto } from './dto/record-click.dto';
import { RecordSiteVisitDto } from './dto/record-site-visit.dto';

/**
 * The public click counter, called from the marketing site.
 *
 * Unauthenticated, because the caller is an anonymous visitor — which is
 * exactly why the DTO accepts one enum value and nothing else. There is no
 * field here for a client to volunteer a session, a referrer or an id, so
 * the "we do not track individuals" claim is enforced by the shape of the
 * request rather than by a promise not to read parts of it.
 *
 * 204 with no body: nothing to tell the caller, and a page should never
 * wait on or react to this. Counts can be inflated by anyone who wants
 * to, and that is accepted: this measures interest, not truth, and
 * defending it properly would need exactly the per-visitor identity this
 * design refuses to collect.
 *
 * **Correction, 2026-08-20 (security review):** the `@Throttle` below was
 * described here as per-IP and is not. `@nestjs/throttler` keys on
 * `req.ip`, which is the socket peer unless Express `trust proxy` is set
 * — and it is not set anywhere in this app. Behind the Cilium gateway
 * that peer is the gateway itself, so every limit in this codebase
 * annotated "per IP" is in fact a single global bucket. The consequence
 * here is that the counter stops recording during a traffic spike, which
 * is when it matters most. Tracked as its own item; it is deliberately
 * not fixed in this commit, because the correct hop count cannot be
 * verified from here and `trust proxy: true` would make the limit
 * trivially evadable by a forged `X-Forwarded-For`.
 */
@Controller('api/v1/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('clicks')
  @HttpCode(HttpStatus.NO_CONTENT)
  async recordClick(@Body() dto: RecordClickDto): Promise<void> {
    await this.analyticsService.recordClick(dto.link);
  }

  /**
   * A read of the public site — one beacon when the page opens, and one
   * when it is hidden carrying how long it was open.
   *
   * Which of the two this is, is decided by whether `dwellSeconds` is
   * present, so a single route serves both and the browser needs no
   * notion of "phase".
   *
   * Throttled harder than clicks: a page fires exactly two of these per
   * read, against up to a handful of clicks, so the honest ceiling is
   * lower. The same caveat as clicks applies and is worth restating —
   * these counts can be inflated by anyone who wants to, and that is
   * accepted, because defending them properly would need exactly the
   * per-visitor identity this design refuses to collect. It measures
   * interest and language split, not truth.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('site-visits')
  @HttpCode(HttpStatus.NO_CONTENT)
  async recordSiteVisit(@Body() dto: RecordSiteVisitDto): Promise<void> {
    // `== null`, not `=== undefined`, and the difference is a real bug
    // rather than style. `@IsOptional()` skips validation for null AS WELL
    // AS undefined, so `{"locale":"sv","dwellSeconds":null}` passes the
    // DTO, is not `undefined`, and used to take the dwell branch — writing
    // a 0-second sample. An unauthenticated loop of those drags the
    // "typical read" toward `0 s`, which is the one reading the entity
    // docstring says must never be shown, because it means "everyone
    // leaves instantly" rather than "we have not measured".
    if (dto.dwellSeconds == null) {
      await this.analyticsService.recordSiteView(dto.locale);
      return;
    }
    await this.analyticsService.recordSiteDwell(dto.locale, dto.dwellSeconds);
  }
}
