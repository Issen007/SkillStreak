import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ChallengeStatus } from '../../challenges/entities/challenge.entity';
import { WeeklyGoalTargetMetric } from '../weekly-goal-target-metric.enum';

const MAX_TITLE_LENGTH = 140;
const MAX_DESCRIPTION_LENGTH = 2000;

// docs/api/phase2-contract.md endpoint 6: the only status *values* a PATCH
// may ever set — whether a given transition from the row's *current*
// status is actually legal (draft->active, active->completed,
// active->cancelled only) is enforced in WeeklyGoalService, not here (that
// needs the current row, not just the request body).
const PATCHABLE_STATUSES = [
  ChallengeStatus.ACTIVE,
  ChallengeStatus.COMPLETED,
  ChallengeStatus.CANCELLED,
] as const;

// All fields optional (a PATCH), per the contract. Whether targetMetric/
// targetValue/startDate/endDate are actually allowed to change (only while
// the row is still `draft`) is a business rule enforced in
// WeeklyGoalService (`challenge_target_frozen`), not something class-
// validator can express — it needs the row's current status.
export class UpdateWeeklyGoalDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TITLE_LENGTH)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string;

  @IsOptional()
  @IsEnum(WeeklyGoalTargetMetric)
  targetMetric?: WeeklyGoalTargetMetric;

  @IsOptional()
  @IsInt()
  @Min(1)
  targetValue?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsIn(PATCHABLE_STATUSES)
  status?: (typeof PATCHABLE_STATUSES)[number];
}
