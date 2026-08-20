import { IsEnum } from 'class-validator';
import { ClipReactionType } from '../../video-clips/entities/clip-reaction.entity';

/**
 * The one field a reaction write carries.
 *
 * `@IsEnum` and nothing else is the point: ADR-0019 Decision 4 requires a
 * closed vocabulary with no freeform text anywhere on the public feed,
 * and a DTO that accepted a string would move that guarantee from the
 * type system into a code review. There is deliberately no `message`, no
 * `comment`, and no place to add one without changing this file.
 */
export class ReactToClipDto {
  @IsEnum(ClipReactionType)
  reaction!: ClipReactionType;
}
