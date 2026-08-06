import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { TeamPoolModule } from '../team-pool/team-pool.module';
import { TeamsModule } from '../teams/teams.module';
import { AccountErasureRequest } from '../account-erasure/entities/account-erasure-request.entity';
import { Player } from './entities/player.entity';
import { StreakSaverEvent } from './entities/streak-saver-event.entity';
import { PlayersController } from './players.controller';
import { PlayersService } from './players.service';

// Hard boundary (docs/adr/0002-data-model.md addendum §1): this module must
// NEVER import PlayerPrivateInfoModule. Team/TeamPool are fine to depend on
// — that constraint is specifically about real_name/parent_contact, not
// about team-scoping in general.
//
// AccountErasureRequest is registered directly via this module's OWN
// `TypeOrmModule.forFeature` (docs/adr/0013-account-erasure.md Decision
// 4's "Module wiring") — NOT by importing AccountErasureModule, which
// would cycle (AccountErasureModule already imports PlayersModule for
// transferCaptaincy/findByIdForUpdate at execution time). Same
// "register the entity directly, not the whole owning module" technique
// WeeklyGoalModule already uses to avoid an equivalent cycle with
// TrainingLogsModule.
@Module({
  imports: [
    // StreakSaverEvent (docs/adr/0024-streak-savers.md Decision 4) is
    // registered directly here for the same reason AccountErasureRequest
    // is — it's only ever written from PlayersService.updateStreakFields,
    // never via its own owning module.
    TypeOrmModule.forFeature([Player, AccountErasureRequest, StreakSaverEvent]),
    AuthModule,
    TeamsModule,
    TeamPoolModule,
  ],
  controllers: [PlayersController],
  providers: [PlayersService],
  exports: [PlayersService],
})
export class PlayersModule {}
