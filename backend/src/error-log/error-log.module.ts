import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisModule } from '../redis/redis.module';
import { ErrorLogEntry } from './entities/error-log-entry.entity';
import { ErrorLogRetentionService } from './error-log-retention.service';
import { ErrorLogService } from './error-log.service';

/**
 * docs/adr/0022-admin-control-center.md Decision 6 — the write side of the
 * error/crash + failed-job visibility pipeline: the recorder
 * (ErrorLogService), its daily retention sweep, and the entity.
 *
 * **No controller here.** Decision 6's read side
 * (`GET /api/v1/admin/errors`, behind `AdminAuthGuard`) belongs with the
 * rest of the admin surface, not in the module every other module has to
 * import in order to record a failure — importing this one must never mean
 * importing an admin-authenticated endpoint. The service and entity are
 * exported so that controller can consume them.
 *
 * Imported by AppModule (for the APP_FILTER-provided AppExceptionFilter)
 * and by the three modules that own a `@Cron` job: VideoClipsModule,
 * AccountErasureModule, UsageMetricsModule.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ErrorLogEntry]), RedisModule],
  providers: [ErrorLogService, ErrorLogRetentionService],
  exports: [ErrorLogService, TypeOrmModule],
})
export class ErrorLogModule {}
