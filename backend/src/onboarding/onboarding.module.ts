import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { PlayerPrivateInfoModule } from '../player-private-info/player-private-info.module';
import { PlayersModule } from '../players/players.module';
import { TeamPoolModule } from '../team-pool/team-pool.module';
import { TeamsModule } from '../teams/teams.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

// The one module allowed to depend on both PlayersModule and
// PlayerPrivateInfoModule at once (see OnboardingService's header comment).
// TeamPoolModule (docs/adr/0009-self-service-team-creation.md Decision 6)
// is new here — OnboardingService.createPlayer's create-a-team branch calls
// TeamPoolService.createInitialSeasonAndPot directly, inside its own
// transaction.
@Module({
  imports: [
    TeamsModule,
    TeamPoolModule,
    PlayersModule,
    PlayerPrivateInfoModule,
    AuthModule,
    MailModule,
  ],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
