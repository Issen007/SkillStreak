import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { TeamPoolModule } from '../team-pool/team-pool.module';
import { TeamsModule } from '../teams/teams.module';
import { Player } from './entities/player.entity';
import { PlayersController } from './players.controller';
import { PlayersService } from './players.service';

// Hard boundary (docs/adr/0002-data-model.md addendum §1): this module must
// NEVER import PlayerPrivateInfoModule. Team/TeamPool are fine to depend on
// — that constraint is specifically about real_name/parent_contact, not
// about team-scoping in general.
@Module({
  imports: [
    TypeOrmModule.forFeature([Player]),
    AuthModule,
    TeamsModule,
    TeamPoolModule,
  ],
  controllers: [PlayersController],
  providers: [PlayersService],
  exports: [PlayersService],
})
export class PlayersModule {}
