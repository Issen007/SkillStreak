import { IsEnum } from 'class-validator';
import { TrackedLink } from '../entities/link-click.entity';

export class RecordClickDto {
  /**
   * The only field. There is deliberately nothing else to send — no
   * identifier, no page, no referrer — so a client cannot volunteer
   * information this system has decided not to hold.
   */
  @IsEnum(TrackedLink)
  link!: TrackedLink;
}
