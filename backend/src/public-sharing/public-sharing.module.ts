import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { PlayerPrivateInfoModule } from '../player-private-info/player-private-info.module';
import { Player } from '../players/entities/player.entity';
import { RedisModule } from '../redis/redis.module';
import { VideoClip } from '../video-clips/entities/video-clip.entity';
import { PublicFeedService } from '../video-clips/public-feed.service';
import { PublicSharingConsent } from './entities/public-sharing-consent.entity';
import { PublicSharingAccessService } from './public-sharing-access.service';
import { PublicSharingConsentService } from './public-sharing-consent.service';
import { PublicSharingController } from './public-sharing.controller';
import { PublicSharingPublicController } from './public-sharing-public.controller';

/**
 * docs/adr/0030-revocable-public-sharing-consent.md.
 *
 * **PublicFeedService is provided here rather than in VideoClipsModule**,
 * even though it queries `video_clip`. It depends on
 * PublicSharingConsentService, and VideoClipsModule importing this module
 * while this module reached back for VideoClipsModule's services would
 * cycle. Keeping the one service that spans both here — with `VideoClip`
 * registered narrowly via forFeature — follows the precedent
 * video-clips.module.ts already set when it took `TeamChatBlock` rather
 * than importing all of TeamChatModule.
 *
 * `Player` is registered the same narrow way and read only for
 * `screen_name` (naming the child on the parent's consent page) and
 * `team_id` (the rollout allow-list).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PublicSharingConsent, Player, VideoClip]),
    AuthModule,
    PlayerPrivateInfoModule,
    MailModule,
    RedisModule,
  ],
  controllers: [PublicSharingController, PublicSharingPublicController],
  providers: [
    PublicSharingConsentService,
    PublicSharingAccessService,
    PublicFeedService,
  ],
  // Exported for the reminder sweep (ADR-0030 Decision 9) once finding 4
  // — the bounce detection the monthly reminder still cannot do — is
  // closed and the scheduled job can honestly be turned on.
  exports: [PublicSharingConsentService, PublicSharingAccessService],
})
export class PublicSharingModule {}
