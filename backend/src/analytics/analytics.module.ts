import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffAuthModule } from '../staff-auth/staff-auth.module';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { LinkClick } from './entities/link-click.entity';
import { SiteVisit } from './entities/site-visit.entity';

/**
 * Link-click counts and app-wide activity figures for the admin console.
 *
 * First-party by design: no third-party analytics SDK, no tracking pixel,
 * no cookie. That is what keeps docs/RELEASING.md's "no trackers" answer
 * true, which the child-directed store review depends on.
 */
@Module({
  imports: [TypeOrmModule.forFeature([LinkClick, SiteVisit]), StaffAuthModule],
  controllers: [AnalyticsController, AdminAnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
