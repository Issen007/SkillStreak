import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BadgeAward } from '../badges/entities/badge-award.entity';
import { Challenge } from '../challenges/entities/challenge.entity';
import { MailModule } from '../mail/mail.module';
import { Player } from '../players/entities/player.entity';
import { RedisModule } from '../redis/redis.module';
import { TeamSeasonPot } from '../team-pool/entities/team-season-pot.entity';
import { TeamChatMessage } from '../team-chat/entities/team-chat-message.entity';
import { TrainingLogEntry } from '../training-logs/entities/training-log-entry.entity';
import { VideoClip } from '../video-clips/entities/video-clip.entity';
import { UsageMetricsQueryService } from './usage-metrics.query.service';
import { UsageMetricsReportService } from './usage-metrics-report.service';
import { UsageMetricsService } from './usage-metrics.service';

/**
 * docs/adr/0020-usage-analytics-product-metrics.md — Fas 5 item 1.
 *
 * Deliberately has **no controller**: Decision 4/5 make the project owner
 * the sole consumer, reached by a scheduled email rather than any endpoint,
 * so there is nothing here for a player, captain, coach, or future
 * admin UI to call. Nothing is exported either — no other module has any
 * business computing these numbers.
 *
 * Entities are registered with `TypeOrmModule.forFeature` directly rather
 * than by importing the modules that own them (the same technique
 * WeeklyGoalModule and AccountErasureModule already use for entities they
 * only read): this module needs read-only repository access across eight
 * tables and has no reason to pull in eight feature modules' services,
 * providers, and cycles to get it. Every one of these repositories is used
 * for aggregate SELECTs only — see UsageMetricsQueryService, which is the
 * only class in the module that touches them.
 *
 * Deliberately NOT registered here: PlayerPrivateInfo (ADR-0002 addendum
 * §1's isolated real_name/parent_contact table — this feature must never be
 * able to read it, so it doesn't get a repository for it at all) and the
 * `team` table (a team's *name* has no place in this report — Decision 3;
 * team-size stratification needs only the ids already on `player`).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Player,
      TrainingLogEntry,
      Challenge,
      TeamSeasonPot,
      VideoClip,
      TeamChatMessage,
      BadgeAward,
    ]),
    MailModule,
    RedisModule,
  ],
  providers: [
    UsageMetricsQueryService,
    UsageMetricsService,
    UsageMetricsReportService,
  ],
})
export class UsageMetricsModule {}
