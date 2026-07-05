import { Module } from '@nestjs/common';
import { PlayerPrivateInfoModule } from '../player-private-info/player-private-info.module';
import { PlayersModule } from '../players/players.module';
import { ConsentController } from './consent.controller';
import { ConsentService } from './consent.service';

// New top-level module for the parent-facing consent-approval link
// (docs/api/phase1-contract.md step 6). Follows OnboardingModule's pattern:
// this is the one other module allowed to depend on both PlayersModule and
// PlayerPrivateInfoModule at once — PlayersModule itself must never import
// PlayerPrivateInfoModule (docs/adr/0002-data-model.md addendum §1).
@Module({
  imports: [PlayersModule, PlayerPrivateInfoModule],
  controllers: [ConsentController],
  providers: [ConsentService],
})
export class ConsentModule {}
