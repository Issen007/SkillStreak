import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsEmailOrPhone } from './is-email-or-phone.validator';

// class-validator's IsNotEmpty only rejects the exact empty string, not a
// whitespace-only one — trim first (same pattern as
// team-chat/dto/create-chat-message.dto.ts) so " " can't slip past
// IsNotEmpty and the content-safety filter to become a permanently-persisted
// blank Team.name/invite_code (teams have no rename/delete).
const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Sane birth-year range: oldest plausible active youth player vs. today.
// Loose on purpose (this is a coarse sanity check, not age gating logic) —
// per ADR-0002, only the year is ever collected, never a full DOB.
//
// Both bounds are rolling offsets from the current year, not fixed
// calendar years — a fixed MIN_BIRTH_YEAR (this used to be a hardcoded
// `2000`) silently drifts wider every year that passes (by 2040, "2000"
// would mean a 40-year-old "player"), so the only way for this range to
// need zero manual updates, ever, is for both ends to move with today.
// 26/4 preserve today's actual accepted range unchanged (2000-2026)
// while fixing that drift and adding a real floor on the upper end (the
// previous MAX_BIRTH_YEAR had no offset at all, technically accepting a
// newborn as a "player").
const OLDEST_ALLOWED_AGE_YEARS = 26;
const YOUNGEST_ALLOWED_AGE_YEARS = 4;
const MIN_BIRTH_YEAR = new Date().getUTCFullYear() - OLDEST_ALLOWED_AGE_YEARS;
const MAX_BIRTH_YEAR = new Date().getUTCFullYear() - YOUNGEST_ALLOWED_AGE_YEARS;

// Generous but bounded — these are display/key strings, not free text, so
// there's no legitimate case for an unbounded value; the caps exist to stop
// a malformed/abusive client request rather than to encode a product rule
// about ideal screen-name length.
const MAX_SCREEN_NAME_LENGTH = 30;
const MAX_AVATAR_ID_LENGTH = 50;
const MAX_PARENT_CONTACT_LENGTH = 254; // standard practical email-length cap

// docs/api/phase1-contract.md's 2026-07-09 addendum implementer note:
// inviteCode previously had no MaxLength at all, fine while it was only
// ever compared against existing rows — now that it may become a
// permanently-persisted Team.invite_code via self-service team creation
// (docs/adr/0009-self-service-team-creation.md), it needs the same kind of
// bound every other free-text onboarding field already has.
const MAX_INVITE_CODE_LENGTH = 30;
// Same note, for the new teamName field — no existing cap on Team.name
// before this (teams were seed-only), this is the first one.
const MAX_TEAM_NAME_LENGTH = 60;

export class CreatePlayerDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_INVITE_CODE_LENGTH)
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

  // docs/adr/0009-self-service-team-creation.md Decision 2 — present if and
  // only if the client already knows (from a prior GET
  // /teams/invite/:inviteCode 404) that inviteCode doesn't match any team
  // and the player has chosen to create one instead of retrying. Absent →
  // byte-for-byte the existing Phase 1 behavior. Checked against the
  // content-safety filter (ADR-0009 Decision 5) inside
  // TeamsService.createTeam, not here — DTO validation only enforces
  // shape/length, not content.
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TEAM_NAME_LENGTH)
  teamName?: string;
}
