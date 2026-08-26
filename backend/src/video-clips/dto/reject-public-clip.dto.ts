import { IsString, Length } from 'class-validator';

export class RejectPublicClipDto {
  /**
   * Why, in words the uploader can act on.
   *
   * Required and floored at 4 characters: an operator who cannot say why
   * in four characters has not decided yet, and a child reading "no" with
   * no reason concludes they did something wrong when they may not have.
   * Capped at the column width.
   */
  @IsString()
  @Length(4, 300)
  reason!: string;
}
