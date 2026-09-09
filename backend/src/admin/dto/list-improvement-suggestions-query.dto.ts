import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ImprovementSuggestionStatus } from '../../improvement-suggestions/entities/improvement-suggestion.entity';

export const DEFAULT_IMPROVEMENT_SUGGESTION_PAGE_SIZE = 50;
export const MAX_IMPROVEMENT_SUGGESTION_PAGE_SIZE = 200;

/**
 * Paginated, filter by `status` — and that is deliberately the entire
 * filter set, exactly as ListBugReportsQueryDto's docstring explains:
 * there must be **no filter, sort or search by the child who wrote it**,
 * so there is no player/team/screen-name parameter here for a UI control
 * to bind to. With `main.ts`'s `forbidNonWhitelisted: true`, adding one
 * would have to be an explicit, reviewable change to this file.
 */
export class ListImprovementSuggestionsQueryDto {
  /** Omitted = the console's "All" chip. */
  @IsOptional()
  @IsEnum(ImprovementSuggestionStatus)
  status?: ImprovementSuggestionStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_IMPROVEMENT_SUGGESTION_PAGE_SIZE)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
