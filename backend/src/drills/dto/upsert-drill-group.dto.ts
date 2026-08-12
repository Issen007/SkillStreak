import {
  IsArray,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

/**
 * Caps exist so a private organising aid stays one. They are generous
 * enough that no real trainer meets them and small enough that the column
 * can't become a document store.
 */
export const DRILL_GROUP_NAME_MAX = 80;
export const DRILL_GROUP_TAG_MAX = 24;
export const DRILL_GROUP_MAX_TAGS = 10;

export class UpsertDrillGroupDto {
  @IsString()
  @Length(1, DRILL_GROUP_NAME_MAX)
  name!: string;

  /**
   * Optional and defaulted rather than required, so "create a group" is
   * one field. `@IsOptional()` with no `@IsNotEmpty()` alongside it —
   * that pairing is what crashed on empty-string env vars in this repo
   * before, and an empty tag list is a legitimate value here.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(DRILL_GROUP_TAG_MAX, { each: true })
  tags?: string[];
}
