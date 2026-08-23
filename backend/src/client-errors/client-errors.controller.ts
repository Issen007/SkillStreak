import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ErrorLogService } from '../error-log/error-log.service';
import { ReportClientErrorDto } from './dto/report-client-error.dto';

/**
 * Where a crash in the Expo app goes.
 *
 * ## Why this exists at all
 *
 * The server sees a request it answered badly and a job that threw. It
 * cannot see a render crash on a phone: the app dies before anything is
 * sent, the child closes it, and there is no trace on any machine the
 * project controls. Through a beta that is fine, because the installs
 * belong to one team the owner can ask in person. The week the app is on
 * the App Store and Google Play, the people it crashes for are strangers
 * and the only signal left is a one-star review.
 *
 * ## Why it is unauthenticated
 *
 * Two reasons, and the second is the stronger one.
 *
 * The practical one: a crash on the sign-in screen, or one caused by a
 * token the app cannot refresh, is exactly the crash worth hearing about,
 * and requiring a session would drop precisely those.
 *
 * The structural one: `error_log_entry` has no player column and is not
 * going to get one (ADR-0022 Decision 6). An authenticated variant would
 * therefore authenticate a caller and then deliberately discard who they
 * are — real complexity buying a guarantee the table already makes by
 * construction. Better to have no identity in the request than to have
 * one and promise not to look.
 *
 * ## What bounds it
 *
 * Not authentication, so it has to be everything else:
 *
 * - **The DTO** — five fields, two of them fixed vocabularies, both text
 *   fields capped at the column width, and `forbidNonWhitelisted` on the
 *   global pipe rejecting anything else outright. There is no field here
 *   through which a child's data could arrive.
 * - **Redaction** — `ErrorLogService.recordClient` scrubs UUIDs and
 *   mailed codes out of every text field, because unlike every other
 *   caller of that service, this text was written by React Native rather
 *   than by this codebase, and RN puts request URLs in error messages as
 *   a matter of routine.
 * - **The throttle** — 30 a minute, genuinely per-IP: `@nestjs/throttler`
 *   keys on `req.ip`, and `main.ts` sets `trust proxy` from
 *   TRUSTED_PROXY_HOPS, so `req.ip` is the real client rather than the
 *   gateway. Worth stating explicitly because it was NOT true until
 *   recently, and several comments in this codebase still say every limit
 *   here is one global bucket.
 *
 *   Even per-IP, a device stuck in a crash loop will hit the ceiling and
 *   have reports dropped. That is the right failure direction — losing
 *   reports is survivable, an unbounded write endpoint is not — but it
 *   means a count in the console is a floor, never a total.
 *
 * ## What it answers with
 *
 * 204, always, and the app never reads it. A crash reporter that can
 * itself surface an error to a child has made the original problem worse.
 */
@Controller('api/v1/client-errors')
export class ClientErrorsController {
  constructor(private readonly errorLogService: ErrorLogService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async report(@Body() dto: ReportClientErrorDto): Promise<void> {
    await this.errorLogService.record({
      source: 'client',
      platform: dto.platform,
      appVersion: dto.appVersion,
      errorName: dto.errorName,
      message: dto.message,
      stack: dto.stack ?? null,
    });
  }
}
