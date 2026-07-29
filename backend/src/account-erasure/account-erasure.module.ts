import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { PlayerPrivateInfoModule } from '../player-private-info/player-private-info.module';
import { PlayersModule } from '../players/players.module';
import { RedisModule } from '../redis/redis.module';
import { VideoClipsModule } from '../video-clips/video-clips.module';
import { VideoClip } from '../video-clips/entities/video-clip.entity';
import { AccountErasureController } from './account-erasure.controller';
import { AccountErasureSweepService } from './account-erasure-sweep.service';
import { AccountErasureService } from './account-erasure.service';
import { AccountErasureRequest } from './entities/account-erasure-request.entity';

// docs/adr/0013-account-erasure.md Decision 3 — mirrors profile/'s
// reasoning exactly: a distinct, narrow, security-relevant concern, not
// folded into PlayersModule.
//
// PlayerPrivateInfoModule is imported directly for exactly one narrow
// read (PlayerPrivateInfoService.hasPendingContactChange/getParentContact)
// — the same already-established pattern ProfileModule/VideoClipsModule
// already use, not a new exception to ADR-0002 addendum §1's "only this
// module may touch this table" rule (Decision 2).
//
// VideoClipsModule is imported for ObjectStorageService only (see that
// module's `exports`) — this feature never re-implements MinIO access.
// VideoClip itself is ALSO registered here via this module's own
// `TypeOrmModule.forFeature` (not by relying on VideoClipsModule to export
// a repository, which it deliberately doesn't) — same "register the
// entity directly" technique WeeklyGoalModule already uses for
// TrainingLogEntry/Team.
//
// Does NOT import AccountErasureModule from PlayersModule (that would
// cycle, since AccountErasureModule already needs PlayersModule for
// transferCaptaincy/findByIdForUpdate at execution time) — see
// PlayersModule's own comment for how it queries account_erasure_request
// without this import (Decision 4's module-wiring fix).
@Module({
  imports: [
    TypeOrmModule.forFeature([AccountErasureRequest, VideoClip]),
    AuthModule,
    PlayersModule,
    PlayerPrivateInfoModule,
    VideoClipsModule,
    RedisModule,
    MailModule,
  ],
  controllers: [AccountErasureController],
  providers: [AccountErasureService, AccountErasureSweepService],
})
export class AccountErasureModule {}
