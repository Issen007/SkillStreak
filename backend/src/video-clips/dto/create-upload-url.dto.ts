import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
} from 'class-validator';
import {
  ALLOWED_CLIP_MIME_TYPES,
  CLIP_CAPTION_MAX_LENGTH,
  CLIP_MAX_DURATION_SECONDS,
  CLIP_MAX_FILE_SIZE_BYTES,
} from '../video-clip.constants';
import type { ClipMimeType } from '../video-clip.constants';

// docs/api/phase3-contract.md endpoint 1. The three technical-validity caps
// (mimeType allow-list, fileSizeBytes, durationSeconds) are enforced here,
// at the DTO boundary — the same "deterministic, class-validator-shaped"
// check ADR-0010 Decision 3 calls for, applied against the client-declared
// values (a HEAD-based spot-check against MinIO's own report happens later,
// at `complete`).
export class CreateUploadUrlDto {
  @IsIn(ALLOWED_CLIP_MIME_TYPES)
  mimeType!: ClipMimeType;

  @IsInt()
  @IsPositive()
  @Max(CLIP_MAX_FILE_SIZE_BYTES)
  fileSizeBytes!: number;

  @IsInt()
  @IsPositive()
  @Max(CLIP_MAX_DURATION_SECONDS)
  durationSeconds!: number;

  // A whitespace-only caption trims to '' and is treated as "no caption"
  // (undefined), not a validation error — unlike chat's mandatory content
  // field, a caption is genuinely optional (docs/design/phase3-flows.md
  // Screen V5: "if no caption, this row is simply absent"), so there's no
  // reason to bounce a client for accidentally submitting blank text.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  })
  @IsString()
  @MaxLength(CLIP_CAPTION_MAX_LENGTH)
  caption?: string;

  @IsOptional()
  @IsUUID()
  taggedPlayerId?: string;
}
