import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PlayerLocale } from '../../common/locale/player-locale.enum';
import { trimString } from '../../common/validation/trim-string.transform';
import { IsEmailOrPhone } from './is-email-or-phone.validator';

// Sane birth-year range: a garbage filter, nothing more.
// Loose on purpose (this is a coarse sanity check, not age gating logic) —
// per ADR-0002, only the year is ever collected, never a full DOB.
//
// Both bounds are rolling offsets from the current year, not fixed
// calendar years — a fixed MIN_BIRTH_YEAR silently drifts wider every year
// that passes, so the only way for this range to need zero manual
// updates, ever, is for both ends to move with today.
//
// **Widened twice now for the same reason, which is the interesting
// part.** 2026-07-26: 26 -> 56, because coaches and parents making their
// own accounts hit the floor. 2026-08-31: 56 -> 120, because a tester born
// before 1970 hit it again and reported that the app told him he was "too
// old" — which it does not mean and should never have implied.
//
// Twice is a pattern, so this is now set where no living person can ever
// hit it rather than at the next plausible-looking number. 120 is past the
// verified human maximum and still rejects the thing this exists to
// reject: a mistyped 1826 or 19999. Picked over "no limit at all" because
// an unbounded smallint accepts year 3 and year 30000, and over 200
// because beyond ~120 it stops filtering anything.
//
// **It has never been age-gating logic and must not become it.** Parental
// consent applies regardless of birth year (ADR-0002 addendum §2), and
// `birth_year` is self-declared with nothing verifying it — so no
// permission may ever hang off this number. See ADR-0030's amendment for
// where that came up in earnest.
const OLDEST_ALLOWED_AGE_YEARS = 120;
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

  // docs/adr/0014-multi-language-support.md Decision 2/Consequences —
  // optional so an old app build that hasn't shipped the O0 language
  // picker yet keeps working; the column's own `DEFAULT 'sv'` covers that
  // case. `@IsEnum` per the ADR's 2026-07-31 security-review correction —
  // without it a malformed value would only be caught downstream by the
  // Postgres enum check, matching every other enum-typed DTO field in this
  // backend (ActivityType, WeeklyGoalTargetMetric, etc.).
  @IsOptional()
  @IsEnum(PlayerLocale)
  locale?: PlayerLocale;
}
