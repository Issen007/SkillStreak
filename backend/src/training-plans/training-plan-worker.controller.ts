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
  TrainingPlanFailureDto,
  TrainingPlanResultDto,
} from './dto/training-plan-result.dto';
import {
  TrainingPlanJob,
  TrainingPlansService,
} from './training-plans.service';
import { TrainingPlanWorkerGuard } from './training-plan-worker.guard';

/**
 * The GPU generator's only way in — the same pull shape clip tagging uses,
 * for the same reason: that cluster has no inbound route, so it reaches
 * out and asks for work.
 *
 * What crosses here is an adult's typed prompt and the adult-authored
 * drill corpus. **No child data, structurally** — the job payload is built
 * from the request DTO plus the drill library, and neither has any field
 * that could hold roster, streak or team data.
 *
 * Separate controller and separate token from clip tagging, so the two
 * features are independently enable-able and a leak of one is not a leak
 * of both.
 */
@Controller('api/v1/training-plan-jobs')
@UseGuards(TrainingPlanWorkerGuard)
export class TrainingPlanWorkerController {
  constructor(private readonly trainingPlansService: TrainingPlansService) {}

  @Post('lease')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async lease(
    @Res({ passthrough: true }) response: Response,
  ): Promise<TrainingPlanJob | undefined> {
    const job = await this.trainingPlansService.leaseNext();
    if (!job) {
      // 204, not an empty 200 — the worker must be able to tell "no work"
      // from a malformed response.
      response.status(HttpStatus.NO_CONTENT);
      return undefined;
    }
    return job;
  }

  @Post('result')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async result(
    @Body() dto: TrainingPlanResultDto,
  ): Promise<{ applied: boolean }> {
    return this.trainingPlansService.applyResult(dto.leaseId, dto.plan, {
      modelId: dto.modelId,
      corpusVersion: dto.corpusVersion,
    });
  }

  @Post('failure')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async failure(
    @Body() dto: TrainingPlanFailureDto,
  ): Promise<{ applied: boolean }> {
    return this.trainingPlansService.reportFailure(dto.leaseId);
  }
}
