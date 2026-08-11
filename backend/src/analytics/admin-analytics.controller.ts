import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../staff-auth/guards/admin-auth.guard';
import { AdminAnalyticsResponse, AnalyticsService } from './analytics.service';

/**
 * The console's analytics view. Admin-only, and app-wide only.
 *
 * There is no team or player parameter, and none may be added — ADR-0020
 * Decision 5's floor is that this surface never becomes a way to look up
 * how a particular child or team is behaving, and the type signatures
 * below have no shape for such a filter to be wired to.
 */
@Controller('api/v1/admin/analytics')
@UseGuards(AdminAuthGuard)
export class AdminAnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get()
  collect(@Query('days') days?: string): Promise<AdminAnalyticsResponse> {
    const parsed = Number(days);
    return this.analyticsService.collect(
      Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
    );
  }
}
