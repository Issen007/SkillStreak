import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ChallengeStatus } from '../../challenges/entities/challenge.entity';
import { WeeklyGoalTargetMetric } from '../weekly-goal-target-metric.enum';

// Generous but bounded, same reasoning as CreatePlayerDto's caps — these
// are captain-authored copy fields, not free text with no legitimate upper
// bound.
const MAX_TITLE_LENGTH = 140;
const MAX_DESCRIPTION_LENGTH = 2000;

// docs/api/phase2-contract.md endpoint 5: only draft/active are legal at
// creation (completed/cancelled make no sense for a goal that doesn't
// exist yet).
const CREATABLE_STATUSES = [
  ChallengeStatus.DRAFT,
  ChallengeStatus.ACTIVE,
] as const;

export class CreateWeeklyGoalDto {
  @IsString()
  @MaxLength(MAX_TITLE_LENGTH)
  title!: string;

  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description!: string;

  @IsEnum(WeeklyGoalTargetMetric)
  targetMetric!: WeeklyGoalTargetMetric;

  @IsInt()
  @Min(1)
  targetValue!: number;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsIn(CREATABLE_STATUSES)
  status!: (typeof CREATABLE_STATUSES)[number];
}
