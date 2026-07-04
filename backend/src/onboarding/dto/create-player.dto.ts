import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

// Sane birth-year range: oldest plausible active youth player vs. today.
// Loose on purpose (this is a coarse sanity check, not age gating logic) —
// per ADR-0002, only the year is ever collected, never a full DOB.
const MIN_BIRTH_YEAR = 2000;
const MAX_BIRTH_YEAR = new Date().getUTCFullYear();

export class CreatePlayerDto {
  @IsString()
  @IsNotEmpty()
  inviteCode!: string;

  @IsString()
  @IsNotEmpty()
  screenName!: string;

  @IsString()
  @IsNotEmpty()
  avatarId!: string;

  @IsInt()
  @Min(MIN_BIRTH_YEAR)
  @Max(MAX_BIRTH_YEAR)
  birthYear!: number;

  @IsString()
  @IsNotEmpty()
  parentContact!: string;
}
