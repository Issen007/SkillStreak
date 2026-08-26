import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DrillsModule } from '../drills/drills.module';
import { StaffAuthModule } from '../staff-auth/staff-auth.module';
import { AuthModule } from '../auth/auth.module';
import { AdminTrainerPostsController } from './admin-trainer-posts.controller';
import { TrainerFeedController } from './trainer-feed.controller';
import { TrainerPost } from './entities/trainer-post.entity';
import { TrainerPostsController } from './trainer-posts.controller';
import { TrainerPostsService } from './trainer-posts.service';

/**
 * Trainer-published tips (owner's decision, 2026-08-13).
 *
 * Three controllers because there are three genuinely different
 * audiences with three different guards: trainers authoring, an admin
 * reviewing, and players reading. Collapsing them would put the
 * publish action one missing decorator away from the authoring routes.
 *
 * Imports DrillsModule for `DrillAccessService` (the same "a team
 * invited you" gate the library uses) and for `findContactDetail` — the
 * no-links rule is the drill library's, reused rather than reimplemented.
 */
@Module({
  imports: [
    DrillsModule,
    StaffAuthModule,
    AuthModule,
    TypeOrmModule.forFeature([TrainerPost]),
  ],
  controllers: [
    TrainerPostsController,
    AdminTrainerPostsController,
    TrainerFeedController,
  ],
  providers: [TrainerPostsService],
  // Exported for TrainingPlansModule (ADR-0035 Decision 1), which hands a
  // verified draft into this module's existing review queue. The service
  // only — the controllers stay private, so importing this never means
  // importing an endpoint.
  exports: [TrainerPostsService],
})
export class TrainerPostsModule {}
