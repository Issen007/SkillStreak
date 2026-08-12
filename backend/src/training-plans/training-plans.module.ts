import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DrillsModule } from '../drills/drills.module';
import { StaffAuthModule } from '../staff-auth/staff-auth.module';
import { TrainingPlanDraft } from './entities/training-plan-draft.entity';
import { TrainingPlanWorkerController } from './training-plan-worker.controller';
import { TrainingPlanWorkerGuard } from './training-plan-worker.guard';
import { TrainingPlansController } from './training-plans.controller';
import { TrainingPlansService } from './training-plans.service';

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
  ],
  controllers: [TrainingPlansController, TrainingPlanWorkerController],
  providers: [TrainingPlansService, TrainingPlanWorkerGuard],
})
export class TrainingPlansModule {}
