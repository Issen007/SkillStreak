import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Coach } from '../coaches/entities/coach.entity';
import { MailModule } from '../mail/mail.module';
import { PlayerPrivateInfoModule } from '../player-private-info/player-private-info.module';
import { PlayersModule } from '../players/players.module';
import { RedisModule } from '../redis/redis.module';
import { TeamCoach } from '../teams/entities/team-coach.entity';
import { TeamsModule } from '../teams/teams.module';
import { CHAT_MODERATION_CHECK } from './chat-moderation-check.interface';
import { KeywordChatModerationCheck } from './keyword-chat-moderation-check';
import { TeamChatBlock } from './entities/team-chat-block.entity';
import { TeamChatMessage } from './entities/team-chat-message.entity';
import { TeamChatMessageReport } from './entities/team-chat-message-report.entity';
import { TeamChatController } from './team-chat.controller';
import { TeamChatService } from './team-chat.service';

// docs/adr/0007-team-chat.md — the highest child-safety-risk feature built
// so far. PlayerPrivateInfoModule is imported here as this module's second
// legitimate caller of PlayerPrivateInfoService.getParentContact (the
// ADR-0007-documented widening of ADR-0002's module-boundary rule — don't
// add a third caller elsewhere without the same explicit treatment).
// Coach/TeamCoach are registered directly (not via a CoachesModule, which
// doesn't exist — both entities are otherwise dormant, see their own
// class comments) purely to read a team's on-file coach email address for
// the report-notification path; nothing about coach login/auth is
// reactivated by this.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      TeamChatMessage,
      TeamChatBlock,
      TeamChatMessageReport,
      TeamCoach,
      Coach,
    ]),
    AuthModule,
    PlayersModule,
    PlayerPrivateInfoModule,
    TeamsModule,
    RedisModule,
    MailModule,
  ],
  controllers: [TeamChatController],
  providers: [
    TeamChatService,
    { provide: CHAT_MODERATION_CHECK, useClass: KeywordChatModerationCheck },
  ],
})
export class TeamChatModule {}
