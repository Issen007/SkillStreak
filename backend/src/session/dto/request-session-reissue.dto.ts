import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { trimString } from '../../common/validation/trim-string.transform';

// Same bounds as CreatePlayerDto's inviteCode/screenName caps — this DTO
// intentionally doesn't import those (they're private to that file, and
// duplicating two numeric literals here is simpler than exporting them
// for a single other caller).
const MAX_INVITE_CODE_LENGTH = 30;
const MAX_SCREEN_NAME_LENGTH = 30;

export class RequestSessionReissueDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_INVITE_CODE_LENGTH)
  inviteCode!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCREEN_NAME_LENGTH)
  screenName!: string;
}
