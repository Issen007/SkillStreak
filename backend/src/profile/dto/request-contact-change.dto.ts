import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsEmailOrPhone } from '../../onboarding/dto/is-email-or-phone.validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Same bound as create-player.dto.ts's parentContact field.
const MAX_CONTACT_LENGTH = 254;

// docs/adr/0012-profile-page-and-contact-email-change.md decision 1, step
// 1. Same format check as onboarding's parentContact (permissive
// email-or-phone) — this is still just PlayerPrivateInfo.parent_contact
// under a new name at this call site, not a new kind of field.
export class RequestContactChangeDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CONTACT_LENGTH)
  @IsEmailOrPhone()
  newContact!: string;
}
