import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { ClipTaggingWorkerUnauthorizedException } from '../common/errors/exceptions';

/**
 * The only thing standing between the public internet and frames of
 * children's training video.
 *
 * That sentence is the whole reason this guard is its own file with its own
 * secret rather than a reused staff or player credential. Under the pull
 * topology the owner chose (2026-08-12, option 2), the GPU cluster has no
 * address of its own, so the work-lease endpoint lives on
 * `api.skillstreak.xyz` where anyone can reach it. There is no network
 * boundary left to hide behind — only this.
 *
 * Consequences of that, each deliberate:
 *
 * - **Its own secret** (`CLIP_TAGGING_WORKER_TOKEN`), shared with nothing.
 *   A leak here must not be a leak of staff sessions or player tokens, and
 *   revoking it must not sign anybody out.
 * - **Absent means off.** With no token configured the endpoints refuse
 *   every request, including one presenting an empty token. A missing
 *   Secret key must never mean "open" — this repo has already shipped
 *   "env var absent, so the feature quietly changed shape" more than once.
 * - **Constant-time comparison**, so a wrong guess leaks nothing about how
 *   wrong it was.
 * - **A minimum length**, checked at startup rather than trusted. A short
 *   token on a public endpoint is not a credential, and the failure is
 *   silent otherwise.
 * - **No detail in the rejection.** Every failure is the same exception
 *   with the same message, so a caller cannot learn whether the feature is
 *   configured at all.
 */
@Injectable()
export class ClipTaggingWorkerGuard implements CanActivate {
  private readonly logger = new Logger(ClipTaggingWorkerGuard.name);

  /** Short enough to be typed into a Secret, long enough that guessing it
   *  is not a strategy. */
  static readonly MIN_TOKEN_LENGTH = 32;

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = (
      this.configService.get<string>('CLIP_TAGGING_WORKER_TOKEN') ?? ''
    ).trim();

    if (!expected) {
      // Not an error state and not logged per-request: an unconfigured
      // deployment (every one except production, by design) would
      // otherwise fill its logs with warnings about a feature it has
      // deliberately not enabled.
      throw new ClipTaggingWorkerUnauthorizedException();
    }

    if (expected.length < ClipTaggingWorkerGuard.MIN_TOKEN_LENGTH) {
      // Configured but too weak. This one IS worth a log line every time,
      // because it is a misconfiguration that looks like a working feature
      // and the endpoint it protects hands out children's video frames.
      this.logger.error(
        'CLIP_TAGGING_WORKER_TOKEN is shorter than ' +
          `${ClipTaggingWorkerGuard.MIN_TOKEN_LENGTH} characters. Refusing ` +
          'every request: this token is the only control on an endpoint ' +
          'that returns derived frames of clips.',
      );
      throw new ClipTaggingWorkerUnauthorizedException();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization ?? '';
    const [scheme, presented] = header.split(' ');

    if (scheme?.toLowerCase() !== 'bearer' || !presented) {
      throw new ClipTaggingWorkerUnauthorizedException();
    }

    if (!ClipTaggingWorkerGuard.matches(presented, expected)) {
      throw new ClipTaggingWorkerUnauthorizedException();
    }

    return true;
  }

  /**
   * `timingSafeEqual` throws on length mismatch, which would itself be a
   * timing signal — so both sides are hashed to a fixed width first. This
   * is the same shape the staff session code uses and is worth keeping
   * identical rather than clever.
   */
  private static matches(presented: string, expected: string): boolean {
    const digest = (value: string): Buffer =>
      createHash('sha256').update(value, 'utf8').digest();
    return timingSafeEqual(digest(presented), digest(expected));
  }
}
