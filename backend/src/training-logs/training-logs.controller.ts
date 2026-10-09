import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlayerId } from '../auth/current-player-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateTrainingLogDto } from './dto/create-training-log.dto';
import {
  ClickOnlyAllowance,
  TrainingLogResponse,
  TrainingLogsService,
} from './training-logs.service';

@Controller('api/v1/training-logs')
export class TrainingLogsController {
  constructor(private readonly trainingLogsService: TrainingLogsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentPlayerId() playerId: string,
    @Body() dto: CreateTrainingLogDto,
  ): Promise<TrainingLogResponse> {
    return this.trainingLogsService.logTraining(playerId, dto);
  }

  // docs/adr/0038 Decision 4 — the weekly click-only allowance, shown
  // before the player chooses how to log.
  @UseGuards(JwtAuthGuard)
  @Get('click-only-allowance')
  async clickOnlyAllowance(
    @CurrentPlayerId() playerId: string,
  ): Promise<ClickOnlyAllowance> {
    return this.trainingLogsService.getClickOnlyAllowance(playerId);
  }
}
