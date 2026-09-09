import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ErrorLogModule } from '../error-log/error-log.module';
import { MailModule } from '../mail/mail.module';
import { RedisModule } from '../redis/redis.module';
import { ImprovementSuggestionDigestService } from './improvement-suggestion-digest.service';
import { ImprovementSuggestionRetentionService } from './improvement-suggestion-retention.service';
import { ImprovementSuggestionsController } from './improvement-suggestions.controller';
import { ImprovementSuggestionsService } from './improvement-suggestions.service';
import { ImprovementSuggestion } from './entities/improvement-suggestion.entity';

/**
 * docs/adr/0037-in-app-improvement-suggestions.md — the **player-facing**
 * half: one authenticated `POST`, plus the two scheduled jobs that own
 * this table's lifecycle (the 90-day sweep and the weekly digest).
 *
 * The admin triage half (`GET`/`PATCH
 * /api/v1/admin/improvement-suggestions`) lives in `admin/`, behind
 * `AdminAuthGuard`, for the same reason BugReportsModule keeps its own
 * out: importing the module a player-facing write lives in must never
 * mean importing an admin-authenticated endpoint. The entity is exported
 * (via `TypeOrmModule`) so AdminModule can read it without redeclaring it.
 *
 * `MailModule` is the one dependency BugReportsModule deliberately does
 * *not* have. It is here only for the counts-only weekly digest — nothing
 * in this module mails a child, a parent or a suggestion's text.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ImprovementSuggestion]),
    AuthModule,
    RedisModule,
    ErrorLogModule,
    MailModule,
  ],
  controllers: [ImprovementSuggestionsController],
  providers: [
    ImprovementSuggestionsService,
    ImprovementSuggestionRetentionService,
    ImprovementSuggestionDigestService,
  ],
  exports: [TypeOrmModule],
})
export class ImprovementSuggestionsModule {}
