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
 * Trim, and additionally strip CR/LF from anything that reaches a mail
 * HEADER rather than a body.
 *
 * `name` and `organisation` are interpolated into the message subject.
 * `trim()` removes leading and trailing whitespace and leaves an interior
 * `\r\n` untouched, so `"Anna\r\nBcc: victim@example.net"` survives it —
 * the textbook header-injection shape.
 *
 * **It is not currently exploitable**, checked rather than assumed during
 * the 2026-08-26 review: nodemailer RFC-2047-encodes the subject, so the
 * CRLF becomes a space inside an encoded word and no second header is
 * emitted. Verified by sending through a stream transport and reading the
 * raw headers.
 *
 * This exists anyway, because that defence belongs to a dependency rather
 * than to us. A transport swap, or a future field that reaches a header
 * through a path nodemailer does not encode, would reopen it silently. A
 * newline in a person's name is worth nothing to keep.
 */
const headerSafe = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').trim() : value;

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
  @Transform(headerSafe)
  name!: string;

  @IsEmail()
  @MaxLength(254)
  @Transform(trimmed)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(headerSafe)
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
