import { ArrayMaxSize, IsArray, IsString, Length } from 'class-validator';

/**
 * Assigning one drill to several groups at once — the "add to groups"
 * action from the drill detail view. The inverse (add several drills to
 * one group) is the same rows written the other way round and is served
 * by calling this per drill; one write path is easier to reason about
 * than two.
 */
export class AddDrillToGroupsDto {
  @IsString()
  @Length(1, 120)
  slug!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  groupIds!: string[];
}
