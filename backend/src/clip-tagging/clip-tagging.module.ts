import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffAuthModule } from '../staff-auth/staff-auth.module';
import { VideoClipsModule } from '../video-clips/video-clips.module';
import { VideoClip } from '../video-clips/entities/video-clip.entity';
import { VideoClipTag } from '../video-clips/entities/video-clip-tag.entity';
import { ClipFrameSamplerService } from './clip-frame-sampler.service';
import { ClipTaggingController } from './clip-tagging.controller';
import { ClipTaggingService } from './clip-tagging.service';
import { ClipTaggingWorkerGuard } from './clip-tagging-worker.guard';
import { AdminClipTaggingController } from './admin-clip-tagging.controller';
import { ClipTaggingStatsService } from './clip-tagging-stats.service';

/**
 * Clip tagging's app-side half — the work queue the GPU cluster pulls from
 * (owner's decision 2026-08-12, option 2 in the design doc's "The route").
 *
 * Its own module rather than a corner of VideoClipsModule, because it is
 * the one part of this app that answers to a machine on another cluster
 * and its access rules share nothing with the player- and staff-facing
 * clip routes. Keeping it separate means "what can the GPU worker reach"
 * is answerable by reading one directory.
 */
@Module({
  imports: [
    VideoClipsModule,
    // AdminAuthGuard injects StaffAuthGuard and the StaffAccount
    // repository; without this the module compiles and fails at boot.
    StaffAuthModule,
    TypeOrmModule.forFeature([VideoClip, VideoClipTag]),
  ],
  controllers: [ClipTaggingController, AdminClipTaggingController],
  providers: [
    ClipTaggingService,
    ClipFrameSamplerService,
    ClipTaggingWorkerGuard,
    ClipTaggingStatsService,
  ],
})
export class ClipTaggingModule {}
