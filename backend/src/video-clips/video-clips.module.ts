import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Coach } from '../coaches/entities/coach.entity';
import { ErrorLogModule } from '../error-log/error-log.module';
import { MailModule } from '../mail/mail.module';
import { ModerationModule } from '../moderation/moderation.module';
import { PlayerPrivateInfoModule } from '../player-private-info/player-private-info.module';
import { PlayersModule } from '../players/players.module';
import { RedisModule } from '../redis/redis.module';
import { TeamChatBlock } from '../team-chat/entities/team-chat-block.entity';
import { TeamChatMessage } from '../team-chat/entities/team-chat-message.entity';
import { TeamCoach } from '../teams/entities/team-coach.entity';
import { TeamsModule } from '../teams/teams.module';
import { ClipRetentionService } from './clip-retention.service';
import { ClipReport } from './entities/clip-report.entity';
import { VideoClip } from './entities/video-clip.entity';
import { ObjectStorageService } from './object-storage.service';
import { StaffAuthModule } from '../staff-auth/staff-auth.module';
import { AdminClipModerationController } from './admin-clip-moderation.controller';
import { AdminClipModerationService } from './admin-clip-moderation.service';
import { ClipModerationDecision } from './entities/clip-moderation-decision.entity';
import { AdminPublicClipReviewController } from './admin-public-clip-review.controller';
import { AdminPublicClipReviewService } from './admin-public-clip-review.service';
import { VideoClipsController } from './video-clips.controller';
import { VideoClipsService } from './video-clips.service';
import { VideoProcessingService } from './video-processing.service';

// docs/adr/0010-video-storage-and-serving.md — the highest child-safety-risk
// feature built so far. PlayerPrivateInfoModule is imported here as this
// module's *third* legitimate caller of PlayerPrivateInfoService.
// getParentContact (the ADR-0010-documented widening of ADR-0002's
// module-boundary rule, after onboarding/ and team-chat/ — don't add a
// fourth caller elsewhere without the same explicit treatment).
//
// TeamChatBlock is registered directly via TypeOrmModule.forFeature (not by
// importing all of TeamChatModule) purely so the feed query can apply
// docs/design/phase3-flows.md's "a block also suppresses clips" filter —
// same "grab just the entity, not the whole sibling module" precedent
// team-chat.module.ts already set for Coach/TeamCoach. Coach/TeamCoach
// themselves are registered the same way, for the identical narrow purpose
// (reading a team's on-file coach email for the report-notification path) —
// nothing about coach login/auth is reactivated by this.
//
// TeamChatMessage is registered the same way, for
// docs/adr/0021-clip-challenge-notifications.md Decision 2's "Module
// wiring": TeamChatModule already imports VideoClipsModule (ADR-0017), so
// the reverse (VideoClipsModule importing TeamChatModule) would cycle.
// VideoClipsService writes a system chat message as a direct repository
// insert inside completeUpload's own transaction, never through
// TeamChatService.postMessage.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      VideoClip,
      ClipReport,
      ClipModerationDecision,
      TeamChatBlock,
      TeamChatMessage,
      TeamCoach,
      Coach,
    ]),
    AuthModule,
    PlayersModule,
    // For AdminAuthGuard on the public-clip review queue. Without it the
    // guard cannot resolve StaffAuthGuard and the WHOLE APP fails to
    // boot — which is exactly what happened on the first push: every
    // unit test passed, because they construct services directly and
    // never build the module graph, and every e2e failed at once.
    StaffAuthModule,
    PlayerPrivateInfoModule,
    TeamsModule,
    RedisModule,
    MailModule,
    // docs/adr/0022-admin-control-center.md Decision 6 — ClipRetentionService
    // records a run-level sweep failure as an `error_log_entry` row.
    ErrorLogModule,
    ModerationModule,
  ],
  controllers: [
    VideoClipsController,
    AdminPublicClipReviewController,
    AdminClipModerationController,
  ],
  providers: [
    VideoClipsService,
    ObjectStorageService,
    VideoProcessingService,
    ClipRetentionService,
    AdminPublicClipReviewService,
    AdminClipModerationService,
  ],
  // ObjectStorageService only, added for
  // docs/adr/0013-account-erasure.md — AccountErasureModule reuses
  // ObjectStorageService.deleteObjectIfExists (never re-implements/forks
  // its own MinIO client) for the same delete-if-exists purge
  // ClipRetentionService already relies on. Nothing else here is exported:
  // VideoClipsService/VideoProcessingService/ClipRetentionService remain
  // this module's own, not reusable elsewhere.
  // VideoProcessingService is exported for ClipTaggingModule's frame
  // sampler, which reuses its temp-file handling rather than growing a
  // second implementation of "write bytes somewhere ffmpeg can read and
  // reliably delete them afterwards".
  exports: [ObjectStorageService, VideoProcessingService],
})
export class VideoClipsModule {}
