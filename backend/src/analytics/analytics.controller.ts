import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AnalyticsService } from './analytics.service';
import { RecordClickDto } from './dto/record-click.dto';

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
 * wait on or react to this. Throttled per IP as a volumetric backstop —
 * counts can be inflated by anyone who wants to, and that is accepted:
 * this measures interest, not truth, and defending it properly would need
 * exactly the per-visitor identity this design refuses to collect.
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
}
