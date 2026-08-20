import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SiteLocale } from '../entities/site-visit.entity';

/**
 * What an anonymous visitor's browser is allowed to tell us about a read
 * of the public site — which is deliberately almost nothing.
 *
 * Two fields, both constrained. There is no field here for a session, a
 * referrer, a path, a screen size or an id, so the "we do not track
 * individuals" claim is enforced by the shape of the request rather than
 * by a promise not to read parts of it — the same argument
 * `RecordClickDto` already makes next door.
 */
export class RecordSiteVisitDto {
  @IsEnum(SiteLocale)
  locale!: SiteLocale;

  /**
   * The short-lived token from `GET /analytics/beacon-token`.
   *
   * Required. See `beacon-token.service.ts` for what it does and does not
   * buy — briefly: it rejects a blind POST from something that never
   * loaded the page, and it is derived from a time bucket only, so it
   * identifies nobody and is byte-identical for every reader in the same
   * five minutes.
   */
  @IsString()
  @MaxLength(200)
  beaconToken!: string;

  /**
   * Seconds the page was actually open, sent once when it is hidden.
   *
   * Omitted on the beacon that fires at page load — that one only says
   * "a read started". Two beacons rather than one because they answer
   * different questions and fail differently: the open beacon counts a
   * visit reliably, while the close beacon only arrives if the browser
   * gets the chance to send it. Merging them would mean losing the visit
   * entirely whenever the duration is unobservable.
   *
   * **Clamped, not merely validated.** The value comes from a stranger's
   * browser and lands in an average, so one request claiming a year of
   * reading would visibly move a number an operator is meant to trust.
   * Four hours is far beyond any real read of a marketing page and far
   * below the range where a single sample can distort the mean.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(4 * 60 * 60)
  dwellSeconds?: number;
}
