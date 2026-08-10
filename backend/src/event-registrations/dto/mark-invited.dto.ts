import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class MarkInvitedDto {
  /**
   * Explicit ids rather than a "mark everything unsent" flag.
   *
   * The admin exports a CSV, mails that exact set of people, and then says
   * which ones were done. Anyone who registers between the export and the
   * mailing must NOT be marked — they were never actually invited, and a
   * flag-everything call would silently swallow them into "already
   * contacted" and they would never hear from us.
   */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(2000)
  @IsUUID('4', { each: true })
  ids!: string[];
}
