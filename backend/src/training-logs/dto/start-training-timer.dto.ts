import { IsEnum, IsInt, Max, Min } from 'class-validator';
import { ActivityType } from '../activity-type.enum';
import { MAX_DURATION_MINUTES } from './create-training-log.dto';

// docs/adr/0038 Decision 2 — `POST /api/v1/training-timers`.
export class StartTrainingTimerDto {
  @IsEnum(ActivityType)
  activityType!: ActivityType;

  @IsInt()
  @Min(1)
  @Max(MAX_DURATION_MINUTES)
  plannedMinutes!: number;
}
