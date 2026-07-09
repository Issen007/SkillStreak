import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModerationModule } from '../moderation/moderation.module';
import { Team } from './entities/team.entity';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

// ModerationModule import (docs/adr/0009-self-service-team-creation.md
// Decision 5) is TeamsService's first non-`Team`-only dependency —
// TeamsService.createTeam injects ChatModerationCheck the same way
// TeamChatService does, via the shared CHAT_MODERATION_CHECK token.
@Module({
  imports: [TypeOrmModule.forFeature([Team]), ModerationModule],
  controllers: [TeamsController],
  providers: [TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
