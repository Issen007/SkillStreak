import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_CLIP_FEED_LIMIT = 20;
export const MAX_CLIP_FEED_LIMIT = 50;

// docs/api/phase3-contract.md endpoint 3's query params.
export class ListClipsQueryDto {
  @IsOptional()
  @IsISO8601()
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_CLIP_FEED_LIMIT)
  limit?: number;
}
