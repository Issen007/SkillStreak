import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  ClipTaggingFailureDto,
  ClipTaggingResultDto,
} from './dto/clip-tagging-result.dto';
import { ClipTaggingLease, ClipTaggingService } from './clip-tagging.service';
import { ClipTaggingWorkerGuard } from './clip-tagging-worker.guard';

/**
 * The GPU cluster's only way in.
 *
 * Three routes, all POST, all bearer-token guarded, and between them they
 * expose exactly one capability: "give me the next thing to look at, and
 * let me tell you what I saw."
 *
 * There is deliberately **no route that names a clip**, no GET, no listing,
 * and no way to ask for anything specific. That is what keeps a stolen
 * token bounded: it can drain the queue of unprocessed clips one at a time,
 * which is bad, but it cannot browse the library, cannot re-fetch a clip it
 * has already seen, and cannot ask for a particular child's video, because
 * no identifier it holds refers to one.
 *
 * Rate-limited well below what the real worker needs. A single GPU takes
 * seconds per clip; a caller managing hundreds of requests a minute is not
 * the worker.
 */
@Controller('api/v1/clip-tagging')
@UseGuards(ClipTaggingWorkerGuard)
export class ClipTaggingController {
  constructor(private readonly clipTaggingService: ClipTaggingService) {}

  /**
   * Claim the next clip. 200 with frames, or **204 when there is nothing
   * to do** — which is the normal state most of the time and must not read
   * as an error, or the worker's logs become noise and a real failure
   * hides in them.
   */
  @Post('lease')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async lease(
    // `passthrough` so Nest still serialises the return value; this only
    // overrides the status code. Returning `undefined` alone would yield
    // an empty 200, which the worker cannot distinguish from a malformed
    // response — hence setting 204 explicitly.
    @Res({ passthrough: true }) response: Response,
  ): Promise<ClipTaggingLease | undefined> {
    const lease = await this.clipTaggingService.leaseNext();
    if (!lease) {
      response.status(HttpStatus.NO_CONTENT);
      return undefined;
    }
    return lease;
  }

  @Post('result')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async result(
    @Body() dto: ClipTaggingResultDto,
  ): Promise<{ applied: boolean }> {
    return this.clipTaggingService.applyResult(dto.leaseId, dto.scores, {
      modelId: dto.modelId,
      promptSetVersion: dto.promptSetVersion,
    });
  }

  /**
   * The worker could not score this one. Frees the lease immediately
   * instead of making the next attempt wait out the TTL — the attempt is
   * already counted, so a clip that always fails still converges on
   * `failed` rather than looping.
   */
  @Post('failure')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async failure(
    @Body() dto: ClipTaggingFailureDto,
  ): Promise<{ applied: boolean }> {
    return this.clipTaggingService.reportFailure(dto.leaseId);
  }
}
