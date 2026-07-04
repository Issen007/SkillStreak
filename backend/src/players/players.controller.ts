import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentPlayerId } from '../auth/current-player-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TeamPoolService } from '../team-pool/team-pool.service';
import { TeamsService } from '../teams/teams.service';
import { stockholmDateString } from '../common/time/stockholm-date.util';
import { PlayersService } from './players.service';

interface PlayerMeResponse {
  player: {
    id: string;
    screenName: string;
    avatarId: string;
    consentStatus: string;
  };
  team: {
    teamId: string;
    teamName: string;
  };
  streak: {
    currentStreakCount: number;
    longestStreakCount: number;
    lastTrainedDate: string | null;
    alreadyLoggedToday: boolean;
  };
  teamPool: {
    seasonId: string;
    seasonLabel: string;
    pointsTotal: number;
    goalThreshold: number;
    percentComplete: number;
    status: string;
  };
}

@Controller('api/v1/players')
export class PlayersController {
  constructor(
    private readonly playersService: PlayersService,
    private readonly teamsService: TeamsService,
    private readonly teamPoolService: TeamPoolService,
  ) {}

  // The combined home-screen fetch — mirrors training-logs' "no second
  // round-trip" principle, per docs/api/phase1-contract.md.
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@CurrentPlayerId() playerId: string): Promise<PlayerMeResponse> {
    const player = await this.playersService.findByIdOrThrow(playerId);
    const team = await this.teamsService.findById(player.teamId);
    if (!team) {
      // Can't occur given the API contract (team_id is a validated FK set
      // at onboarding time) — surfaced as a 500 rather than defended
      // against as if it were normal client input.
      throw new Error(
        `Player ${playerId} references missing team ${player.teamId}`,
      );
    }
    const pot = await this.teamPoolService.getActivePotForTeam(player.teamId);
    const season = await this.teamPoolService.getSeason(pot.seasonId);
    if (!season) {
      throw new Error(
        `TeamSeasonPot ${pot.id} references missing season ${pot.seasonId}`,
      );
    }

    const today = stockholmDateString();
    // Derived straight from Postgres (the source of truth), same as the
    // training-logs write path's alreadyLoggedToday — Redis's copy of this
    // is a write-path accelerator for other consumers, not read here.
    const alreadyLoggedToday = player.lastTrainedDate === today;

    return {
      player: {
        id: player.id,
        screenName: player.screenName,
        avatarId: player.avatarId,
        consentStatus: player.parentalConsentStatus,
      },
      team: {
        teamId: team.id,
        teamName: team.name,
      },
      streak: {
        currentStreakCount: player.currentStreakCount,
        longestStreakCount: player.longestStreakCount,
        lastTrainedDate: player.lastTrainedDate,
        alreadyLoggedToday,
      },
      teamPool: {
        seasonId: season.id,
        seasonLabel: season.label,
        pointsTotal: pot.pointsTotal,
        goalThreshold: pot.goalThreshold,
        percentComplete: TeamPoolService.percentComplete(
          pot.pointsTotal,
          pot.goalThreshold,
        ),
        status: pot.status,
      },
    };
  }
}
