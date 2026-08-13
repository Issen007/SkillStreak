import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DrillsModule } from '../drills/drills.module';
import { StaffAuthModule } from '../staff-auth/staff-auth.module';
import { TrainingPlanDraft } from './entities/training-plan-draft.entity';
import { TrainingPlanWorkerController } from './training-plan-worker.controller';
import { TrainingPlanWorkerGuard } from './training-plan-worker.guard';
import { TrainingPlansController } from './training-plans.controller';
import { AdminTrainingPlansController } from './admin-training-plans.controller';
import { TrainingPlanStatsService } from './training-plan-stats.service';
import { TrainingPlansService } from './training-plans.service';
import { TrainingPlanRetentionService } from './training-plan-retention.service';
import { ErrorLogModule } from '../error-log/error-log.module';
import { RedisModule } from '../redis/redis.module';

/**
 * The coach training-plan generator (ADR-0028 Phase 1).
 *
 * Imports DrillsModule because the drill library IS the corpus — "one
 * corpus, two consumers", as DrillsModule's own comment anticipated. The
 * corpus therefore lives in this repository, is reviewable in a diff, and
 * **still exists if the GPU cluster does not**, which is ADR-0028 Decision
 * 14's requirement that the app keep working without the cluster.
 */
@Module({
  imports: [
    DrillsModule,
    StaffAuthModule,
    TypeOrmModule.forFeature([TrainingPlanDraft]),
    // The retention sweep records its own failures as error-log rows
    // and claims its run through Redis, exactly like the four sweeps
    // that came before it.
    ErrorLogModule,
    RedisModule,
  ],
  controllers: [
    TrainingPlansController,
    TrainingPlanWorkerController,
    AdminTrainingPlansController,
  ],
  providers: [
    TrainingPlansService,
    TrainingPlanWorkerGuard,
    TrainingPlanRetentionService,
    TrainingPlanStatsService,
  ],
})
export class TrainingPlansModule {}
