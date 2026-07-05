import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { PlayerPrivateInfoModule } from '../player-private-info/player-private-info.module';
import { PlayersModule } from '../players/players.module';
import { TeamsModule } from '../teams/teams.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

// The one module allowed to depend on both PlayersModule and
// PlayerPrivateInfoModule at once (see OnboardingService's header comment).
@Module({
  imports: [
    TeamsModule,
    PlayersModule,
    PlayerPrivateInfoModule,
    AuthModule,
    MailModule,
  ],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
