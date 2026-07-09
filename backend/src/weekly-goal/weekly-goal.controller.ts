import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlayerId } from '../auth/current-player-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CaptainTransferResult,
  PlayersService,
  TeammateEntry,
} from '../players/players.service';
import { TransferCaptaincyDto } from '../players/dto/transfer-captaincy.dto';
import { CreateWeeklyGoalDto } from './dto/create-weekly-goal.dto';
import { UpdateWeeklyGoalDto } from './dto/update-weekly-goal.dto';
import {
  DashboardResponse,
  GoalProgressSummary,
  LeaderboardResponse,
  RosterEntry,
  WeeklyGoalRow,
  WeeklyGoalService,
} from './weekly-goal.service';

interface CaptainTransferResponse {
  teamId: string;
  previousCaptainPlayerId: string;
  newCaptainPlayerId: string;
  transferredAt: string;
}

// Every team-scoped `/api/v1/teams/:teamId/...` route in this app lives
// here — not just weekly-goal CRUD anymore (dashboard/roster since Phase 2,
// captain-transfer/teammates since Fas 2.6a, the leaderboard since Fas
// 2.7). Kept as one controller deliberately (ADR-0006/ADR-0008: "reuses the
// existing team-scoped controller" rather than introducing a new one per
// feature) — a rename to something like `TeamController` was considered
// but deferred as a bigger refactor than any single phase needs; the class
// name is legacy, the route table is the real contract. Every method
// delegates its own team-membership/captain check to WeeklyGoalService/
// PlayersService (which in turn call PlayersService's shared methods)
// rather than reimplementing it here, per the contract's implementer note.
@Controller('api/v1/teams/:teamId')
export class WeeklyGoalController {
  constructor(
    private readonly weeklyGoalService: WeeklyGoalService,
    private readonly playersService: PlayersService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('dashboard')
  async getDashboard(
    @Param('teamId') teamId: string,
    @CurrentPlayerId() playerId: string,
  ): Promise<DashboardResponse> {
    return this.weeklyGoalService.getDashboard(teamId, playerId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('roster')
  async getRoster(
    @Param('teamId') teamId: string,
    @CurrentPlayerId() playerId: string,
  ): Promise<{ players: RosterEntry[] }> {
    const players = await this.weeklyGoalService.getRoster(teamId, playerId);
    return { players };
  }

  @UseGuards(JwtAuthGuard)
  @Post('weekly-goal')
  @HttpCode(HttpStatus.CREATED)
  async createGoal(
    @Param('teamId') teamId: string,
    @CurrentPlayerId() playerId: string,
    @Body() dto: CreateWeeklyGoalDto,
  ): Promise<WeeklyGoalRow> {
    return this.weeklyGoalService.createGoal(teamId, playerId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('weekly-goal/:id')
  async patchGoal(
    @Param('teamId') teamId: string,
    @Param('id') id: string,
    @CurrentPlayerId() playerId: string,
    @Body() dto: UpdateWeeklyGoalDto,
  ): Promise<WeeklyGoalRow> {
    return this.weeklyGoalService.patchGoal(teamId, id, playerId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('weekly-goal')
  async getCurrentGoal(
    @Param('teamId') teamId: string,
    @CurrentPlayerId() playerId: string,
  ): Promise<{ goal: GoalProgressSummary | null; viewerIsCaptain: boolean }> {
    return this.weeklyGoalService.getCurrentGoalForTeam(teamId, playerId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('weekly-goal/history')
  async getHistory(
    @Param('teamId') teamId: string,
    @CurrentPlayerId() playerId: string,
  ): Promise<{ goals: GoalProgressSummary[] }> {
    return this.weeklyGoalService.getHistoryForTeam(teamId, playerId);
  }

  // Fas 2.6a (docs/adr/0006-captain-transfer.md, phase2-contract.md's
  // 2026-07-08 addendum, endpoint 9) — delegates straight to
  // PlayersService, not WeeklyGoalService: this only ever touches the
  // Player table, no dependency on Challenge/TeamSeasonPot.
  @UseGuards(JwtAuthGuard)
  @Post('captain-transfer')
  @HttpCode(HttpStatus.OK)
  async transferCaptaincy(
    @Param('teamId') teamId: string,
    @CurrentPlayerId() playerId: string,
    @Body() dto: TransferCaptaincyDto,
  ): Promise<CaptainTransferResponse> {
    const result: CaptainTransferResult =
      await this.playersService.transferCaptaincy(
        teamId,
        playerId,
        dto.newCaptainPlayerId,
      );
    return {
      teamId: result.teamId,
      previousCaptainPlayerId: result.previousCaptainPlayerId,
      newCaptainPlayerId: result.newCaptainPlayerId,
      transferredAt: result.transferredAt.toISOString(),
    };
  }

  // Fas 2.6a (ADR-0006 Decision 2, endpoint 10) — team-membership only, not
  // captain-gated: a deliberately narrower read than the roster endpoint
  // above (no consentStatus/lastTrainedDate).
  @UseGuards(JwtAuthGuard)
  @Get('teammates')
  async getTeammates(
    @Param('teamId') teamId: string,
    @CurrentPlayerId() playerId: string,
  ): Promise<{ teammates: TeammateEntry[] }> {
    const teammates = await this.playersService.listTeammates(teamId, playerId);
    return { teammates };
  }

  // Fas 2.7 (docs/adr/0008-vm-guld-cross-team-leaderboard.md,
  // docs/api/phase2.7-contract.md) — no captain gate, same posture as
  // dashboard/roster's team-membership-only reads.
  @UseGuards(JwtAuthGuard)
  @Get('leaderboard')
  async getLeaderboard(
    @Param('teamId') teamId: string,
    @CurrentPlayerId() playerId: string,
  ): Promise<LeaderboardResponse> {
    return this.weeklyGoalService.getLeaderboard(teamId, playerId);
  }
}
