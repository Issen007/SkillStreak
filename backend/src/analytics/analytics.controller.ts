import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AnalyticsService } from './analytics.service';
import { BeaconTokenService } from './beacon-token.service';
import { SiteOriginGuard } from './site-origin.guard';
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
 * **Correction, 2026-08-20 (security review), now itself resolved:** the
 * `@Throttle` below was described here as per-IP and was not.
 * `@nestjs/throttler` keys on `req.ip`, which is the socket peer unless
 * Express `trust proxy` is set — and at the time it was set nowhere, so
 * behind the Cilium gateway that peer was the gateway itself and every
 * limit in this codebase annotated "per IP" was a single global bucket.
 *
 * **Fixed since**: `main.ts` sets `trust proxy` to TRUSTED_PROXY_HOPS
 * (1 in `k8s/configmap.yaml` — one gateway hop), so `req.ip` is now the
 * real client and these limits are per-IP as described. A hop COUNT
 * rather than `trust proxy: true` is the point: `true` would take the
 * leftmost `X-Forwarded-For` entry, which a caller can forge, making the
 * limit trivially evadable. Left as a correction-of-a-correction rather
 * than deleted, because the false version of this note travelled into
 * other files.
 */
@Controller('api/v1/analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly beaconTokens: BeaconTokenService,
  ) {}

  /**
   * Mints the short-lived token the two counters below require.
   *
   * Rate limited tighter than the writes it authorises: a page needs one
   * per load, so anything above that rate is not a reader. Combined with
   * per-IP throttling (main.ts's `trust proxy`, without which this is one
   * global bucket) this is what bounds the whole flow rather than just
   * the write.
   */
  @UseGuards(SiteOriginGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('beacon-token')
  issueBeaconToken(): { token: string } {
    return { token: this.beaconTokens.issue() };
  }

  private assertBeacon(token: unknown): void {
    if (!this.beaconTokens.verify(token)) {
      // 403 rather than 401: there is no identity to authenticate and no
      // credential to re-present, so a WWW-Authenticate challenge would be
      // meaningless. The page never reads this — counting must never
      // surface an error to a visitor — so the status is for operators.
      throw new ForbiddenException('invalid_or_expired_beacon_token');
    }
  }

  @UseGuards(SiteOriginGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('clicks')
  @HttpCode(HttpStatus.NO_CONTENT)
  async recordClick(@Body() dto: RecordClickDto): Promise<void> {
    this.assertBeacon(dto.beaconToken);
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
  @UseGuards(SiteOriginGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('site-visits')
  @HttpCode(HttpStatus.NO_CONTENT)
  async recordSiteVisit(@Body() dto: RecordSiteVisitDto): Promise<void> {
    this.assertBeacon(dto.beaconToken);
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
