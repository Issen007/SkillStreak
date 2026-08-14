import { IsIn, IsOptional, IsString, Length } from 'class-validator';
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
}

export class RejectTrainerPostDto {
  @IsString()
  @Length(3, 300)
  reason!: string;
}
