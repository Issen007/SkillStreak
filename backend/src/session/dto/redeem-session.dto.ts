import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Loose upper bound — a sanity check against garbage input, not a strict
// format check (the code is compared verbatim against
// Player.session_reissue_code either way, so an over-length value simply
// won't match anything real).
const MAX_CODE_LENGTH = 32;

export class RedeemSessionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CODE_LENGTH)
  code!: string;
}
