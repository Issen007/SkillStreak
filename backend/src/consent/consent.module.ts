import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { PlayerPrivateInfoModule } from '../player-private-info/player-private-info.module';
import { PlayersModule } from '../players/players.module';
import { RedisModule } from '../redis/redis.module';
import { TeamsModule } from '../teams/teams.module';
import { ConsentReminderController } from './consent-reminder.controller';
import { ConsentController } from './consent.controller';
import { ConsentService } from './consent.service';

// New top-level module for the parent-facing consent-approval link
// (docs/api/phase1-contract.md step 6) and, since Phase 2, the
// captain-facing consent-reminder-resend action (docs/api/phase2-
// contract.md endpoint 3, ADR-0005). Follows OnboardingModule's pattern:
// this is one of the few modules allowed to depend on both PlayersModule
// and PlayerPrivateInfoModule at once — PlayersModule itself must never
// import PlayerPrivateInfoModule (docs/adr/0002-data-model.md addendum §1).
// AuthModule is imported directly (not just transitively via PlayersModule)
// because ConsentReminderController's `@UseGuards(JwtAuthGuard)` needs it
// resolvable in *this* module's own container — Nest doesn't propagate a
// module's imports to its importers, only its `exports`, and PlayersModule
// doesn't re-export AuthModule.
@Module({
  imports: [
    AuthModule,
    PlayersModule,
    PlayerPrivateInfoModule,
    TeamsModule,
    RedisModule,
    MailModule,
  ],
  controllers: [ConsentController, ConsentReminderController],
  providers: [ConsentService],
})
export class ConsentModule {}
