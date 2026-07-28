import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { PlayerPrivateInfoModule } from '../player-private-info/player-private-info.module';
import { PlayersModule } from '../players/players.module';
import { RedisModule } from '../redis/redis.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

// docs/adr/0012-profile-page-and-contact-email-change.md — a focused
// module for this one auth-lifecycle-adjacent concern, same reasoning as
// ConsentModule/SessionModule being their own modules rather than folded
// into PlayersModule/PlayerPrivateInfoModule. AuthModule imported
// directly (not just transitively via PlayersModule) because
// ProfileController's `@UseGuards(JwtAuthGuard)` needs it resolvable in
// this module's own container — same note as ConsentModule's.
@Module({
  imports: [
    AuthModule,
    PlayersModule,
    PlayerPrivateInfoModule,
    RedisModule,
    MailModule,
  ],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
