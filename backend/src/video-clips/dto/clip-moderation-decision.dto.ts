import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ClipModerationDecisionDto {
  /**
   * Why, for the record. Optional, unlike the public-review rejection
   * reason, and the difference is deliberate: that one is shown to the
   * child and a refusal without a reason is cruel. This one is
   * operator-facing only, and requiring prose for an obvious call would
   * push somebody toward typing "x" to get past the field.
   *
   * `@IsOptional()` alone, never stacked with `@IsNotEmpty()` — see
   * config/env.validation.spec.ts for why that pairing is a trap this
   * project keeps meeting.
   */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
