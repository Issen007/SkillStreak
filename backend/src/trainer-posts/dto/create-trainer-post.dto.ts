import { Type } from 'class-transformer';
import {
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

export class CreateTrainerPostDto {
  @IsString()
  @Length(4, 120)
  title!: string;

  @IsString()
  @Length(20, 4000)
  body!: string;

  /**
   * How readers see the author. Required, because publishing anonymously
   * to children is not a thing this feature offers: a tip on a child's
   * screen should say who wrote it.
   */
  @IsString()
  @Length(2, 80)
  authorByline!: string;

  @IsOptional()
  @IsIn(['sv', 'en'])
  locale?: string;

  // Reuses the drill library's vocabularies so a post and a drill can be
  // filtered the same way, and so neither is free text.
  @IsOptional()
  @IsIn([...DRILL_AGE_BANDS])
  ageBand?: string;

  @IsOptional()
  @IsIn([...DRILL_FOCUSES])
  focus?: string;

  /**
   * Minutes, for a post that is a drill rather than a prose tip.
   *
   * Bounded the same way `CreateTrainingLogDto` bounds its own duration —
   * a loose sanity check against garbage, not a product rule about how
   * long a session may be. 180 is already implausible for a 9-year-old's
   * drill and leaves no room to type a year into the field.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(180)
  durationMinutes?: number;
}

export class RejectTrainerPostDto {
  @IsString()
  @Length(3, 300)
  reason!: string;
}
