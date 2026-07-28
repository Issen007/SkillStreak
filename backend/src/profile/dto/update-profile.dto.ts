import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

// Same trim-before-validate reasoning as create-player.dto.ts.
const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// A generous but bounded cap, same posture as this app's other free-text
// profile fields (MAX_SCREEN_NAME_LENGTH etc. in create-player.dto.ts) —
// not a product statement about ideal name length.
const MAX_REAL_NAME_LENGTH = 80;

// docs/adr/0012-profile-page-and-contact-email-change.md decision 4 —
// real name only. Birth year is deliberately absent: read-only on the
// profile page (decision 2), no update path exists for it anywhere.
// Contact-email changes go through the separate request/confirm DTOs
// below, not this one, since that flow needs the notify-old/confirm-new
// dance, not a direct write.
export class UpdateProfileDto {
  // Explicit `null` clears a previously-set name (the field is optional,
  // per PlayerPrivateInfo.realName's own "some parents will prefer not
  // to store it at all" comment) — `undefined`/omitted leaves it
  // unchanged, matching PATCH semantics.
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(MAX_REAL_NAME_LENGTH)
  realName?: string | null;
}
