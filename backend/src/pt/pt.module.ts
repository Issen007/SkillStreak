import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Badge } from '../badges/entities/badge.entity';
import { BadgeAward } from '../badges/entities/badge-award.entity';
import { Challenge } from '../challenges/entities/challenge.entity';
import { MailModule } from '../mail/mail.module';
import { PlayerPrivateInfoModule } from '../player-private-info/player-private-info.module';
import { Player } from '../players/entities/player.entity';
import { PlayersModule } from '../players/players.module';
import { RedisModule } from '../redis/redis.module';
import { StaffAuthModule } from '../staff-auth/staff-auth.module';
import { Team } from '../teams/entities/team.entity';
import { TeamPoolModule } from '../team-pool/team-pool.module';
import { TrainingLogEntry } from '../training-logs/entities/training-log-entry.entity';
import { WeeklyGoalModule } from '../weekly-goal/weekly-goal.module';
import { PtTeamLink } from './entities/pt-team-link.entity';
import { PtPlayerConsent } from './entities/pt-player-consent.entity';
import { PtConsentPublicController } from './pt-consent-public.controller';
import { PtConsentService } from './pt-consent.service';
import { PtDataService } from './pt-data.service';
import { PtPlayerConsentsController } from './pt-player-consents.controller';
import { PtTeamLinksController } from './pt-team-links.controller';
import { PtTeamLinksService } from './pt-team-links.service';
import { PtController } from './pt.controller';

// docs/adr/0023-pt-role-and-staff-sso-rbac.md Part A — the PT/coach role's
// entire read-only data surface plus its two-step consent chain. Depends
// on Part B's StaffAuthModule (StaffAccount repository + PtAuthGuard) for
// something a PT logs into at all, per the ADR's own sequencing.
//
// Team/Player/Challenge/TrainingLogEntry/Badge/BadgeAward are registered
// directly via this module's OWN `TypeOrmModule.forFeature` (not by
// importing their owning modules), the same "register the entity
// directly, not the whole owning module" technique WeeklyGoalModule/
// AccountErasureModule already use — this module only ever READS these
// entities (Decision A5's allow-list), it never writes to any of them.
// PlayersModule/TeamPoolModule/WeeklyGoalModule are still imported
// separately for their own service-layer logic (assertIsCaptainOfTeam,
// getActivePotForTeam, computeTeamProgress) that this module reuses rather
// than re-deriving.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PtTeamLink,
      PtPlayerConsent,
      Team,
      Player,
      Challenge,
      TrainingLogEntry,
      Badge,
      BadgeAward,
    ]),
    AuthModule,
    StaffAuthModule,
    PlayersModule,
    PlayerPrivateInfoModule,
    TeamPoolModule,
    WeeklyGoalModule,
    RedisModule,
    MailModule,
  ],
  controllers: [
    PtTeamLinksController,
    PtController,
    PtConsentPublicController,
    PtPlayerConsentsController,
  ],
  providers: [PtTeamLinksService, PtConsentService, PtDataService],
})
export class PtModule {}
