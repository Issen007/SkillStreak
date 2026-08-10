import {
  Equals,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import {
  EventRegistrationInterest,
  EventRegistrationLocale,
} from '../entities/event-registration.entity';
import {
  EVENT_REGISTRATION_CAMPAIGN_MAX_LENGTH,
  EVENT_REGISTRATION_EMAIL_MAX_LENGTH,
  EVENT_REGISTRATION_NAME_MAX_LENGTH,
  EVENT_REGISTRATION_NOTE_MAX_LENGTH,
} from '../event-registrations.constants';

export class CreateEventRegistrationDto {
  @IsString()
  @Length(1, EVENT_REGISTRATION_NAME_MAX_LENGTH)
  name!: string;

  @IsEmail()
  @MaxLength(EVENT_REGISTRATION_EMAIL_MAX_LENGTH)
  email!: string;

  @IsEnum(EventRegistrationInterest)
  interest!: EventRegistrationInterest;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_REGISTRATION_NOTE_MAX_LENGTH)
  note?: string;

  @IsEnum(EventRegistrationLocale)
  locale!: EventRegistrationLocale;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_REGISTRATION_CAMPAIGN_MAX_LENGTH)
  campaign?: string;

  /**
   * Consent, and the reason this is `@Equals(true)` rather than a plain
   * boolean: the lawful basis for holding this row is the person agreeing,
   * so `false` is not a variant to store — it is a request not to be
   * stored at all, and the right answer is to reject it at the boundary.
   */
  @IsBoolean()
  @Equals(true)
  privacyAccepted!: boolean;

  /**
   * Honeypot. Real people never see this field; bots that fill in every
   * input do.
   *
   * It has to be declared here at all because the global ValidationPipe
   * runs with `forbidNonWhitelisted: true` — an undeclared field would be
   * a 400, which tells a bot precisely what to stop sending. Declared and
   * ignored, the submission looks like it worked (see the service).
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
