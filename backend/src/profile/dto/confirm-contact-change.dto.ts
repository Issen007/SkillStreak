import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Same loose upper bound reasoning as session/dto/redeem-session.dto.ts —
// a sanity check, not a strict format check; the code is compared verbatim
// against the stored value either way.
const MAX_CODE_LENGTH = 32;

export class ConfirmContactChangeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CODE_LENGTH)
  code!: string;
}
