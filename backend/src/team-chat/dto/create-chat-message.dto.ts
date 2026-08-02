import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const MAX_CONTENT_LENGTH = 500;

// docs/api/phase2.6b-contract.md endpoint 1 / docs/adr/0017-chat-clip-
// attachments.md Decision 4/5: "content: 1-500 chars trimmed IF clipId
// absent; 0-500 chars if clipId present". Trimming happens here, at the DTO
// boundary (via class-transformer, which the global ValidationPipe's
// `transform: true` runs before class-validator's checks) — so content is
// already trimmed by the time it reaches TeamChatService.
//
// Deliberately no `@MinLength(1)` here (unlike before ADR-0017): whether an
// empty/whitespace-only `content` is acceptable now depends on `clipId`,
// which is a cross-field rule this DTO can't express as a single
// class-validator constraint that still reports the right error code. Per
// the ADR's exact check order (Decision 5), that combined rule — "both
// content empty and clipId absent is 400" — is enforced in
// TeamChatService.postMessage instead, *after* the clip-resolution check
// (step 3), not here. `@MaxLength` stays a plain DTO-level check either way
// (unchanged, "or content over the length cap").
export class CreateChatMessageDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(MAX_CONTENT_LENGTH)
  content!: string;

  // Must resolve to a `published` clip on this team — validated in
  // TeamChatService.postMessage (docs/adr/0017-chat-clip-attachments.md
  // Decision 1), not here; this DTO only checks the shape.
  @IsOptional()
  @IsUUID()
  clipId?: string;
}
