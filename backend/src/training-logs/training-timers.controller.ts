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
import { StartTrainingTimerDto } from './dto/start-training-timer.dto';
import {
  TrainingTimerResponse,
  TrainingTimersService,
} from './training-timers.service';

// docs/adr/0038 Decision 2.
@Controller('api/v1/training-timers')
export class TrainingTimersController {
  constructor(private readonly trainingTimersService: TrainingTimersService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async start(
    @CurrentPlayerId() playerId: string,
    @Body() dto: StartTrainingTimerDto,
  ): Promise<TrainingTimerResponse> {
    return this.trainingTimersService.start(playerId, dto);
  }
}
