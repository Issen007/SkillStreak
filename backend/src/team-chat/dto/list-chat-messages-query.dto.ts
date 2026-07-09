import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_CHAT_MESSAGE_LIMIT = 50;
export const MAX_CHAT_MESSAGE_LIMIT = 200;

// docs/api/phase2.6b-contract.md endpoint 2's query params. Query-string
// values always arrive as strings — `@Type(() => Number)` (class-
// transformer) converts `limit` before class-validator's @IsInt/@Min/@Max
// run against it, same "transform then validate" order the global
// ValidationPipe already relies on elsewhere in this app.
export class ListChatMessagesQueryDto {
  @IsOptional()
  @IsISO8601()
  after?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_CHAT_MESSAGE_LIMIT)
  limit?: number;
}
