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
import { CreateWeeklyGoalDto } from './dto/create-weekly-goal.dto';
import { UpdateWeeklyGoalDto } from './dto/update-weekly-goal.dto';
import {
  DashboardResponse,
  GoalProgressSummary,
  RosterEntry,
  WeeklyGoalRow,
  WeeklyGoalService,
} from './weekly-goal.service';

// All Phase 2 team-scoped endpoints from docs/api/phase2-contract.md —
// dashboard/roster (any teammate vs. captain-only, respectively) and the
// weekly-goal CRUD. Every method delegates its own team-membership/captain
// check to WeeklyGoalService (which in turn calls PlayersService's shared
// methods) rather than reimplementing it here, per the contract's
// implementer note.
@Controller('api/v1/teams/:teamId')
export class WeeklyGoalController {
  constructor(private readonly weeklyGoalService: WeeklyGoalService) {}

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
}
