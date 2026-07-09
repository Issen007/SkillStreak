import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

const MAX_CONTENT_LENGTH = 500;

// docs/api/phase2.6b-contract.md endpoint 1: "1-500 chars after trim;
// empty/whitespace-only rejected." Trimming happens here, at the DTO
// boundary (via class-transformer, which the global ValidationPipe's
// `transform: true` runs before class-validator's checks) — so
// content is already trimmed by the time it reaches TeamChatService, and a
// whitespace-only submission (which trims to '') is rejected by MinLength
// rather than silently stored as an empty/blank message.
export class CreateChatMessageDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_CONTENT_LENGTH)
  content!: string;
}
