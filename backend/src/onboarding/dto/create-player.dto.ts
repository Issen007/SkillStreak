import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsEmailOrPhone } from './is-email-or-phone.validator';

// Sane birth-year range: oldest plausible active youth player vs. today.
// Loose on purpose (this is a coarse sanity check, not age gating logic) —
// per ADR-0002, only the year is ever collected, never a full DOB.
const MIN_BIRTH_YEAR = 2000;
const MAX_BIRTH_YEAR = new Date().getUTCFullYear();

// Generous but bounded — these are display/key strings, not free text, so
// there's no legitimate case for an unbounded value; the caps exist to stop
// a malformed/abusive client request rather than to encode a product rule
// about ideal screen-name length.
const MAX_SCREEN_NAME_LENGTH = 30;
const MAX_AVATAR_ID_LENGTH = 50;
const MAX_PARENT_CONTACT_LENGTH = 254; // standard practical email-length cap

export class CreatePlayerDto {
  @IsString()
  @IsNotEmpty()
  inviteCode!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCREEN_NAME_LENGTH)
  screenName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_AVATAR_ID_LENGTH)
  avatarId!: string;

  @IsInt()
  @Min(MIN_BIRTH_YEAR)
  @Max(MAX_BIRTH_YEAR)
  birthYear!: number;

  // Format-checked (permissive email-or-phone, see IsEmailOrPhone) so an
  // obviously-malformed value (e.g. "asdf") is rejected at the boundary
  // instead of silently creating a player whose consent request can never
  // be delivered to anyone, per docs/adr/0002-data-model.md addendum §2.
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PARENT_CONTACT_LENGTH)
  @IsEmailOrPhone()
  parentContact!: string;
}
