import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Coach } from '../coaches/entities/coach.entity';
import { MailModule } from '../mail/mail.module';
import { ModerationModule } from '../moderation/moderation.module';
import { PlayerPrivateInfoModule } from '../player-private-info/player-private-info.module';
import { PlayersModule } from '../players/players.module';
import { RedisModule } from '../redis/redis.module';
import { TeamChatBlock } from '../team-chat/entities/team-chat-block.entity';
import { TeamCoach } from '../teams/entities/team-coach.entity';
import { TeamsModule } from '../teams/teams.module';
import { ClipRetentionService } from './clip-retention.service';
import { ClipReport } from './entities/clip-report.entity';
import { VideoClip } from './entities/video-clip.entity';
import { ObjectStorageService } from './object-storage.service';
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
@Module({
  imports: [
    TypeOrmModule.forFeature([
      VideoClip,
      ClipReport,
      TeamChatBlock,
      TeamCoach,
      Coach,
    ]),
    AuthModule,
    PlayersModule,
    PlayerPrivateInfoModule,
    TeamsModule,
    RedisModule,
    MailModule,
    ModerationModule,
  ],
  controllers: [VideoClipsController],
  providers: [
    VideoClipsService,
    ObjectStorageService,
    VideoProcessingService,
    ClipRetentionService,
  ],
})
export class VideoClipsModule {}
