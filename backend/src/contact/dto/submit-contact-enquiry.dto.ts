import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform, type TransformFnParams } from 'class-transformer';

/**
 * Trims leading/trailing whitespace before validation runs.
 *
 * Extracted rather than repeated inline three times, and typed rather
 * than left to class-transformer's `any`: a padded `"  "` would otherwise
 * satisfy `@MinLength(1)` and arrive as an empty name.
 */
const trimmed = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * A sponsorship or partnership enquiry from the public site.
 *
 * Adult-facing by construction: nothing on the child-facing surfaces links
 * here, and the form lives in the sponsors section of the marketing page.
 * That is why it carries no consent machinery — but it is still personal
 * data, and the design keeps it to the minimum that lets someone be
 * replied to.
 */
export class SubmitContactEnquiryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Transform(trimmed)
  name!: string;

  @IsEmail()
  @MaxLength(254)
  @Transform(trimmed)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(trimmed)
  organisation?: string;

  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  message!: string;

  /**
   * The honeypot. A real person never sees this field and never fills it;
   * a form-filling bot fills everything it finds.
   *
   * A honeypot rather than a CAPTCHA, and that is a deliberate house
   * rule rather than laziness: this project ships no CAPTCHA anywhere,
   * and putting one on a site a nine-year-old can reach is a bad
   * precedent to set for a form only adults use.
   *
   * Declared here rather than silently ignored so that
   * `forbidNonWhitelisted` does not reject the very submissions the trap
   * is meant to catch — a 400 would tell a bot it had been spotted, and
   * the trap works better when it looks like it worked.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
