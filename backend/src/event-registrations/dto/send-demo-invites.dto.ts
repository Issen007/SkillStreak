import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class SendDemoInvitesDto {
  /**
   * The Google Meet link.
   *
   * Constrained to `https://meet.google.com/...` rather than accepting any
   * URL. Without this the admin console is a button that mails an
   * arbitrary link to every address on the list — which is a phishing tool
   * with an audience, one compromised admin session away from being used.
   * A conference link is the only thing this endpoint has any business
   * sending, so that is the only thing it accepts.
   *
   * If a different conferencing provider is ever wanted, widen this
   * deliberately by adding a host — do not relax it to "any https URL".
   */
  @IsString()
  @Matches(/^https:\/\/meet\.google\.com\/[A-Za-z0-9?=&_-]+$/, {
    message: 'meetUrl must be a https://meet.google.com/... link',
  })
  meetUrl!: string;

  /** When the demo starts, as an ISO 8601 instant. */
  @IsISO8601({ strict: true })
  startsAt!: string;

  @IsInt()
  @Min(5)
  @Max(480)
  durationMinutes!: number;

  /**
   * Optional note from the sender, shown above the join link. Plain text —
   * it is HTML-escaped by the template, so pasted markup arrives as the
   * characters that were typed rather than as markup.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;

  /**
   * Re-send to people already marked as invited.
   *
   * Off by default and named explicitly, because the accident this guards
   * against — mailing the whole list twice — is both easy and expensive:
   * it is the fastest way to teach recipients to mark us as spam, and a
   * damaged sending reputation takes the parental-consent email with it.
   */
  @IsOptional()
  @IsBoolean()
  resend?: boolean;
}
