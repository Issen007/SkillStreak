import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ErrorLogEntry,
  ErrorLogSource,
} from './entities/error-log-entry.entity';
import {
  DEFAULT_ERROR_LOG_RETENTION_DAYS,
  DEFAULT_ERROR_LOG_STACK_MAX_FRAMES,
} from './error-log.constants';
import {
  describeError,
  positiveIntFromConfig,
  redactUnmatchedRouteMessage,
  truncateMessage,
  truncateStack,
} from './error-log.util';

/**
 * A discriminated union, not one wide optional-everything object: an `http`
 * failure and a `job` failure are genuinely different events with different
 * columns (Decision 6's schema), and this makes it impossible to record a
 * job row that carries a route or an http row that carries a job name.
 *
 * Note what is NOT accepted here, per Decision 6's redaction allow-list:
 * no request body, no query string, no headers, no resolved path. The
 * caller cannot pass them because there is no field for them.
 */
export type ErrorLogRecordInput =
  | {
      source: 'http';
      /** The Express route TEMPLATE, or null for an unmatched request. */
      route: string | null;
      method: string | null;
      statusCode: number | null;
      error: unknown;
    }
  | {
      source: 'job';
      /** One of ERROR_LOG_JOB_NAMES. */
      jobName: string;
      error: unknown;
    };

/**
 * docs/adr/0022-admin-control-center.md Decision 6 — the single writer of
 * `error_log_entry`. Two callers today: AppExceptionFilter (every branch,
 * including 4xx domain errors — "which domain errors are actually happening
 * in practice" is real operational signal this app has never had) and the
 * `@Cron` jobs' own try/catch blocks.
 *
 * **`record()` never throws and never rejects.** This is the load-bearing
 * property of the whole class, not a nicety: it is called from inside the
 * global exception filter, where a failure would turn one error into a
 * second, unhandled one on a response that is already in flight — and from
 * inside scheduled jobs, where a rejection escapes into `@nestjs/schedule`'s
 * bare `console.error` instead of this app's Logger. Every failure path
 * (a dead database, a schema that hasn't been migrated yet, a pathological
 * error object) degrades to a log line, exactly like MailService's
 * unconfigured-SMTP no-op.
 *
 * The callers deliberately do NOT await it — recording is fire-and-forget,
 * so it can never delay an HTTP response. That's safe precisely because the
 * returned promise is guaranteed never to reject.
 */
@Injectable()
export class ErrorLogService {
  private readonly logger = new Logger(ErrorLogService.name);

  constructor(
    @InjectRepository(ErrorLogEntry)
    private readonly errorLogRepository: Repository<ErrorLogEntry>,
    private readonly configService: ConfigService,
  ) {}

  async record(input: ErrorLogRecordInput): Promise<void> {
    try {
      const described = describeError(input.error);
      // Only for an unmatched HTTP request, where Nest's own default 404
      // message is the resolved URL and nothing else — see
      // redactUnmatchedRouteMessage.
      const message =
        input.source === 'http' && input.route === null
          ? redactUnmatchedRouteMessage(described.message)
          : described.message;
      await this.errorLogRepository.insert({
        occurredAt: new Date(),
        source:
          input.source === 'http' ? ErrorLogSource.HTTP : ErrorLogSource.JOB,
        route: input.source === 'http' ? input.route : null,
        method: input.source === 'http' ? input.method : null,
        jobName: input.source === 'job' ? input.jobName : null,
        statusCode: input.source === 'http' ? input.statusCode : null,
        // `error_name` is an unbounded varchar, but it's fed by whatever
        // class an arbitrary library threw, so it gets the same ceiling as
        // `message` rather than being trusted to be short.
        errorName: truncateMessage(described.name),
        message: truncateMessage(message),
        stack: truncateStack(described.stack, this.stackMaxFrames()),
      });
    } catch (error) {
      // Never rethrow — see the class docstring. `logger.error` is the same
      // ephemeral-stdout path this app had before Decision 6 existed, which
      // is the correct fallback when the durable path is the thing that's
      // broken.
      this.logger.error(
        `Failed to record an ${input.source} error into error_log_entry — dropped: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Decision 6's retention cutoff, read here rather than in the sweep so
   * the admin API can echo the SAME number the sweep actually uses. The
   * console interpolates it ("Kept {retentionDays} days, then deleted.")
   * instead of hardcoding 90 — see
   * docs/design/phase7-admin-console-flows.md §5.2/§13.
   */
  retentionDays(): number {
    return positiveIntFromConfig(
      this.configService.get<string>('ERROR_LOG_RETENTION_DAYS'),
      DEFAULT_ERROR_LOG_RETENTION_DAYS,
    );
  }

  /**
   * Decision 6's stack-truncation frame count, echoed by the admin API for
   * the same reason as above (the console labels the stack block "first
   * {maxFrames} frames, truncated on write").
   */
  stackMaxFrames(): number {
    return positiveIntFromConfig(
      this.configService.get<string>('ERROR_LOG_STACK_MAX_FRAMES'),
      DEFAULT_ERROR_LOG_STACK_MAX_FRAMES,
    );
  }
}
