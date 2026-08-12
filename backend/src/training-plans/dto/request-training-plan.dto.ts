import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import {
  DRILL_AGE_BANDS,
  DRILL_FOCUSES,
} from '../../drills/drill-library.service';

export enum TrainingPlanLocale {
  SV = 'sv',
  EN = 'en',
}

/**
 * ADR-0028 Decision 7(c)'s structural control, expressed as a type.
 *
 * These five fields are the ENTIRE request that reaches the generator.
 * There is no player field, no team field, no roster field, and no
 * "personalise for my team" flag — and adding one would be a visible
 * change to this file rather than a quiet enrichment somewhere in a
 * service. That is the whole mechanism: a coach can still type a name
 * into `promptText`, but this app will never assemble child data into a
 * prompt on their behalf.
 */
export class RequestTrainingPlanDto {
  @IsString()
  @Length(3, 1000)
  promptText!: string;

  // Reuses the drill library's bands so a plan and the drills it cites
  // speak the same language. An age RANGE, never a birth date.
  @IsIn([...DRILL_AGE_BANDS])
  ageBand!: string;

  @IsInt()
  @Min(5)
  @Max(180)
  durationMinutes!: number;

  @IsOptional()
  @IsIn([...DRILL_FOCUSES])
  focus?: string;

  @IsOptional()
  @IsEnum(TrainingPlanLocale)
  locale?: TrainingPlanLocale;
}
