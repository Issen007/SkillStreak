import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import {
  assertConsentApproved,
  assertTeamJoinApproved,
} from '../players/player-access.util';
import { PlayersService } from '../players/players.service';
import { StartTrainingTimerDto } from './dto/start-training-timer.dto';
import { TrainingTimer } from './entities/training-timer.entity';

const MS_PER_MINUTE = 60 * 1000;

export interface TrainingTimerResponse {
  timerId: string;
  startedAt: string;
  plannedMinutes: number;
  endsAt: string;
}

/**
 * docs/adr/0038 Decision 2 — the server keeps the clock. A timer that lived
 * only on the phone would be a tap with extra steps; here `startedAt` is
 * the server's, and `POST /training-logs` measures elapsed time against it.
 *
 * Kept apart from TrainingLogsService because starting a timer writes no
 * log, no streak and no points — it only opens the window a later log is
 * measured against.
 */
@Injectable()
export class TrainingTimersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly playersService: PlayersService,
  ) {}

  async start(
    playerId: string,
    dto: StartTrainingTimerDto,
  ): Promise<TrainingTimerResponse> {
    // Same two gates as logging, before the transaction opens.
    const player = await this.playersService.findByIdOrThrow(playerId);
    assertConsentApproved(player.parentalConsentStatus);
    assertTeamJoinApproved(player.teamJoinStatus);

    return this.dataSource.transaction(async (manager) => {
      // The player row lock serializes this against a concurrent start and
      // against a log consuming the timer being replaced — the same lock
      // TrainingLogsService.logTraining takes before it reads a timer.
      const lockedPlayer = await this.playersService.findByIdForUpdate(
        manager,
        playerId,
      );
      assertConsentApproved(lockedPlayer.parentalConsentStatus);
      assertTeamJoinApproved(lockedPlayer.teamJoinStatus);

      const repository = manager.getRepository(TrainingTimer);
      // "Starting a new timer abandons any unused one" — at most one open
      // timer per player (also a partial unique index). Deleted rather than
      // flagged: an unconsumed timer verified nothing and no log points at
      // it, so there is nothing to keep it for.
      await repository.delete({ playerId, consumedAt: IsNull() });

      const timer = await repository.save(
        repository.create({
          playerId,
          activityType: dto.activityType,
          plannedMinutes: dto.plannedMinutes,
          startedAt: new Date(),
          consumedAt: null,
        }),
      );

      return {
        timerId: timer.id,
        startedAt: timer.startedAt.toISOString(),
        plannedMinutes: timer.plannedMinutes,
        endsAt: new Date(
          timer.startedAt.getTime() + timer.plannedMinutes * MS_PER_MINUTE,
        ).toISOString(),
      };
    });
  }
}
