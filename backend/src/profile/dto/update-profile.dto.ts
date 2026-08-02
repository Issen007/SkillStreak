import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PlayerLocale } from '../../common/locale/player-locale.enum';
import { trimString } from '../../common/validation/trim-string.transform';

// A generous but bounded cap, same posture as this app's other free-text
// profile fields (MAX_SCREEN_NAME_LENGTH etc. in create-player.dto.ts) —
// not a product statement about ideal name length.
const MAX_REAL_NAME_LENGTH = 80;

// Same cap as create-player.dto.ts's own MAX_AVATAR_ID_LENGTH (not
// imported — each DTO in this app defines its own length constants
// rather than sharing them, same posture as MAX_REAL_NAME_LENGTH above).
// No server-side whitelist against AVATAR_CATALOG here either, matching
// onboarding's own existing validation posture for this field — it's a
// non-PII, client-side emoji-lookup key with a safe fallback if unknown,
// not a security-relevant value.
const MAX_AVATAR_ID_LENGTH = 50;

// docs/adr/0012-profile-page-and-contact-email-change.md decision 4 —
// real name, plus avatarId (added 2026-07-28, same low-risk "direct
// PATCH, no confirmation flow" reasoning — a display choice, not an
// account-recovery-adjacent field). Birth year is deliberately absent:
// read-only on the profile page (decision 2), no update path exists for
// it anywhere. Contact-email changes go through the separate
// request/confirm DTOs below, not this one, since that flow needs the
// notify-old/confirm-new dance, not a direct write.
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

  // Not nullable — unlike realName, every account always has an avatar
  // (set at onboarding); there's no "clear it" state to represent.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_AVATAR_ID_LENGTH)
  avatarId?: string;

  // docs/adr/0014-multi-language-support.md Consequences — optional,
  // omitted (not `null`-able; every player already always has one) leaves
  // it unchanged, matching PATCH semantics. `@IsEnum` per the ADR's
  // 2026-07-31 security-review correction — matches CreatePlayerDto's own
  // `locale` field and every other enum-typed DTO field in this backend.
  @IsOptional()
  @IsEnum(PlayerLocale)
  locale?: PlayerLocale;
}
