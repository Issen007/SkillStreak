import { IsEnum, IsString, MaxLength } from 'class-validator';
import { TrackedLink } from '../entities/link-click.entity';

export class RecordClickDto {
  /**
   * Which link. There is deliberately no identifier, page or referrer
   * field — a client cannot volunteer information this system has decided
   * not to hold.
   */
  @IsEnum(TrackedLink)
  link!: TrackedLink;

  /**
   * The short-lived token from `GET /analytics/beacon-token`.
   *
   * Added 2026-08-20 alongside the same requirement on site visits, so
   * both public counters have one rule rather than two. It carries a time
   * bucket and nothing else — no visitor, no session — so it identifies
   * nobody and is byte-identical for every reader in the same five
   * minutes. See `beacon-token.service.ts` for what it does and does not
   * buy.
   */
  @IsString()
  @MaxLength(200)
  beaconToken!: string;
}
