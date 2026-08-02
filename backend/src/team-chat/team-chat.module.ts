import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Coach } from '../coaches/entities/coach.entity';
import { MailModule } from '../mail/mail.module';
import { ModerationModule } from '../moderation/moderation.module';
import { PlayerPrivateInfoModule } from '../player-private-info/player-private-info.module';
import { PlayersModule } from '../players/players.module';
import { RedisModule } from '../redis/redis.module';
import { TeamCoach } from '../teams/entities/team-coach.entity';
import { TeamsModule } from '../teams/teams.module';
import { VideoClip } from '../video-clips/entities/video-clip.entity';
import { VideoClipsModule } from '../video-clips/video-clips.module';
import { TeamChatBlock } from './entities/team-chat-block.entity';
import { TeamChatMessage } from './entities/team-chat-message.entity';
import { TeamChatMessageReport } from './entities/team-chat-message-report.entity';
import { TeamChatController } from './team-chat.controller';
import { TeamChatService } from './team-chat.service';

// docs/adr/0007-team-chat.md — the highest child-safety-risk feature built
// so far. PlayerPrivateInfoModule is imported here as this module's second
// legitimate caller of PlayerPrivateInfoService.getParentContact (the
// ADR-0007-documented widening of ADR-0002's module-boundary rule — don't
// add a third caller elsewhere without the same explicit treatment).
// Coach/TeamCoach are registered directly (not via a CoachesModule, which
// doesn't exist — both entities are otherwise dormant, see their own
// class comments) purely to read a team's on-file coach email address for
// the report-notification path; nothing about coach login/auth is
// reactivated by this. The CHAT_MODERATION_CHECK binding itself now lives
// in ModerationModule (docs/adr/0009-self-service-team-creation.md
// Decision 5) — imported here rather than declared inline, so
// TeamsModule can reuse the identical binding without importing all of
// this module. Behavior is unchanged; this is a pure extraction.
//
// docs/adr/0017-chat-clip-attachments.md — VideoClip is registered directly
// via TypeOrmModule.forFeature (same "grab just the entity, not the whole
// sibling module" precedent as TeamChatBlock/TeamCoach/Coach above) so
// TeamChatService can run its own team-scoped loaded-row check (write time)
// and join (read time) against it — see that ADR's Decision 1, don't add a
// bare, unscoped `findOne({ id })` against this repository anywhere.
// VideoClipsModule is imported (not just the entity) purely to reuse its
// already-exported ObjectStorageService singleton for presigning clip
// playback URLs — the same singleton the clip feed itself mints from, not a
// second MinIO client/bucket-init pass. One-directional: video-clips/ has
// no dependency back on team-chat/.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      TeamChatMessage,
      TeamChatBlock,
      TeamChatMessageReport,
      TeamCoach,
      Coach,
      VideoClip,
    ]),
    AuthModule,
    PlayersModule,
    PlayerPrivateInfoModule,
    TeamsModule,
    RedisModule,
    MailModule,
    ModerationModule,
    VideoClipsModule,
  ],
  controllers: [TeamChatController],
  providers: [TeamChatService],
})
export class TeamChatModule {}
