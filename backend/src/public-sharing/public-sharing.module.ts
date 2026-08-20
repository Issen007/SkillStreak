import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ErrorLogModule } from '../error-log/error-log.module';
import { MailModule } from '../mail/mail.module';
import { PlayerPrivateInfoModule } from '../player-private-info/player-private-info.module';
import { Player } from '../players/entities/player.entity';
import { RedisModule } from '../redis/redis.module';
import { ClipReaction } from '../video-clips/entities/clip-reaction.entity';
import { VideoClip } from '../video-clips/entities/video-clip.entity';
import { ClipReactionsService } from '../video-clips/clip-reactions.service';
import { PublicFeedService } from '../video-clips/public-feed.service';
import { PublicSharingConsent } from './entities/public-sharing-consent.entity';
import { BounceMailboxService } from './bounce-mailbox.service';
import { PublicSharingAccessService } from './public-sharing-access.service';
import { PublicSharingConsentService } from './public-sharing-consent.service';
import { PublicSharingController } from './public-sharing.controller';
import { PublicSharingPublicController } from './public-sharing-public.controller';
import { PublicSharingReminderService } from './public-sharing-reminder.service';

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
    TypeOrmModule.forFeature([
      PublicSharingConsent,
      Player,
      VideoClip,
      ClipReaction,
    ]),
    AuthModule,
    PlayerPrivateInfoModule,
    MailModule,
    RedisModule,
    // For the two scheduled jobs below: a failed run gets a row rather
    // than disappearing into an unobserved rejected promise, the same
    // way every other @Cron-owning module here records one.
    ErrorLogModule,
  ],
  controllers: [PublicSharingController, PublicSharingPublicController],
  providers: [
    PublicSharingConsentService,
    PublicSharingAccessService,
    PublicFeedService,
    // Lives here for the same reason PublicFeedService does: it depends on
    // the feed's visibility gate, and VideoClipsModule importing this one
    // while this one reached back would cycle.
    ClipReactionsService,
    // ADR-0030 finding 4, closed 2026-08-19. The order matters for
    // reading, not for DI: the bounce mailbox is what supplies the
    // delivery signal, and the reminder sweep is what was waiting on it.
    BounceMailboxService,
    PublicSharingReminderService,
  ],
  // The reminder sweep and the bounce intake both live in this module
  // now (finding 4 closed 2026-08-19), so nothing outside needs them.
  // The two services below stay exported for ADR-0019's feed.
  exports: [PublicSharingConsentService, PublicSharingAccessService],
})
export class PublicSharingModule {}
