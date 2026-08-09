import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CLIP_CAPTION_MAX_LENGTH } from '../video-clip.constants';

/**
 * The optional metadata a background upload supplies at `complete` instead
 * of at `create` (docs/internal/BACKLOG.md, 2026-08-09).
 *
 * The original flow mints the upload URL only once the player has written
 * a caption and chosen a tag, so the bytes cannot start moving until they
 * have finished typing. Starting the transfer the moment a file is picked
 * means the caption does not exist yet — so it arrives here.
 *
 * **Every rule is copied from `CreateUploadUrlDto` deliberately, field for
 * field**, including the whitespace-only-becomes-undefined transform: two
 * paths that write the same two columns must not disagree about what is
 * acceptable in them. The service-layer checks (moderation on the caption,
 * team-membership and approval on the tag) are shared as real methods
 * rather than copied — see VideoClipsService's two assert helpers.
 *
 * **Contract**: an omitted field leaves whatever `create` already stored
 * untouched (which is why the original flow is unaffected); an explicit
 * `null` clears it. Both fields agree on that. They previously did not —
 * `@IsOptional()` skips validation for `null` as well as `undefined`, so a
 * `null` caption slipped through to a `.trim()` and threw *after* the
 * remux had run, while a `null` tag silently cleared. Handled in
 * `VideoClipsService.completeUpload` now, before any storage work.
 */
export class CompleteUploadDto {
  // A whitespace-only caption trims to '' and is treated as "no caption"
  // (undefined), not a validation error — identical to the create DTO's
  // own reasoning.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  })
  @IsString()
  @MaxLength(CLIP_CAPTION_MAX_LENGTH)
  caption?: string | null;

  @IsOptional()
  @IsUUID()
  taggedPlayerId?: string | null;
}
