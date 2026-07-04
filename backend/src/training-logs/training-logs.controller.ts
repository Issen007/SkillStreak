import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlayerId } from '../auth/current-player-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateTrainingLogDto } from './dto/create-training-log.dto';
import {
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
}
