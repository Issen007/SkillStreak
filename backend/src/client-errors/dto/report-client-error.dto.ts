import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ERROR_LOG_MESSAGE_MAX_LENGTH } from '../../error-log/error-log.constants';
import { CLIENT_ERROR_PLATFORMS } from '../client-errors.constants';

/**
 * Every field a crashing app may send, and there are five.
 *
 * The list is the security control. This is an unauthenticated endpoint
 * that accepts text from a child's device, so what stops it becoming a
 * channel for child data is that there is nowhere to put any: no screen
 * name, no player or team id, no device identifier, no route, no
 * free-form "context" object, no breadcrumbs. A caller cannot volunteer
 * them, because `forbidNonWhitelisted` on the global ValidationPipe
 * rejects a body carrying a property this class does not declare.
 *
 * That mirrors how ADR-0022 Decision 6 keeps `error_log_entry` free of
 * child references in the first place — by the absence of a column rather
 * than by a rule about what to write into one.
 *
 * Both text fields are capped at the database's own widths rather than at
 * something larger the service would later truncate. A caller that sends
 * more gets a 400 telling it so, which is a better contract than silently
 * storing a prefix.
 */
export class ReportClientErrorDto {
  @IsIn(CLIENT_ERROR_PLATFORMS)
  platform!: string;

  /**
   * `EXPO_PUBLIC_APP_VERSION` as the crashing build reports it — a release
   * tag (`v0.3.1`), or `main-<sha>`/`prerelease-<sha>` off a channel
   * build. Constrained to that shape's character set so this cannot become
   * a 64-character free-text field by another name.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._-]+$/)
  appVersion!: string;

  /** The exception class — 'TypeError', 'Error', or our own names. */
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  errorName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(ERROR_LOG_MESSAGE_MAX_LENGTH)
  message!: string;

  /**
   * Absent for a non-Error throw, which is common in a JS runtime and must
   * not cost the report. `@IsOptional()` alone, never stacked with
   * `@IsNotEmpty()` — see config/env.validation.spec.ts for why that
   * pairing is a trap this project has now met six times.
   */
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  stack?: string;
}
