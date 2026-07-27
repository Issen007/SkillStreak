import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { PlayerPrivateInfoModule } from '../player-private-info/player-private-info.module';
import { PlayersModule } from '../players/players.module';
import { RedisModule } from '../redis/redis.module';
import { TeamsModule } from '../teams/teams.module';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';

// PlayerPrivateInfoModule/TeamsModule/RedisModule/MailModule added
// 2026-07-27 for the reissue-code-by-email redesign — same "this is one
// of the few modules allowed to depend on both PlayersModule and
// PlayerPrivateInfoModule at once" reasoning as ConsentModule (see its own
// comment); PlayersModule itself must never import PlayerPrivateInfoModule
// directly, per docs/adr/0002-data-model.md addendum §1.
@Module({
  imports: [
    AuthModule,
    PlayersModule,
    PlayerPrivateInfoModule,
    TeamsModule,
    RedisModule,
    MailModule,
  ],
  controllers: [SessionController],
  providers: [SessionService],
})
export class SessionModule {}
