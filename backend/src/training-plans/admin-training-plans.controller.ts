import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../staff-auth/guards/admin-auth.guard';
import {
  TrainingPlanStats,
  TrainingPlanStatsService,
} from './training-plan-stats.service';

/**
 * The console's plan-generation panel. Admin-only, app-wide only.
 *
 * Deliberately returns counts and never a prompt: those are adults' own
 * words and may contain a name (ADR-0028 Decision 7(c)). An operator
 * checking whether the generator is alive does not need to read what
 * anyone asked it for.
 */
@Controller('api/v1/admin/training-plans')
@UseGuards(AdminAuthGuard)
export class AdminTrainingPlansController {
  constructor(
    private readonly trainingPlanStatsService: TrainingPlanStatsService,
  ) {}

  @Get('stats')
  stats(): Promise<TrainingPlanStats> {
    return this.trainingPlanStatsService.collect();
  }
}
