import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { PlayerLocale } from '../../common/locale/player-locale.enum';
import {
  IMPROVEMENT_SUGGESTION_BODY_MAX_LENGTH,
  IMPROVEMENT_SUGGESTION_VERSION_STRING_MAX_LENGTH,
} from '../improvement-suggestions.constants';

/**
 * docs/adr/0037-in-app-improvement-suggestions.md's capture allow-list,
 * expressed as a DTO — the boundary where "a fixed, allow-listed set"
 * stops being prose and starts being enforced.
 *
 * **What has no field here, and so cannot be sent at all**: any location
 * value (CLAUDE.md's non-negotiable), a device identifier or advertising
 * id, an IP address, a screenshot, an attachment, and `playerId` — which
 * the server takes from the session (`CurrentPlayerId`) and never from
 * the body. `main.ts`'s global `ValidationPipe` runs with
 * `whitelist: true, forbidNonWhitelisted: true`, so a client sending any
 * of those gets a 400 rather than having it silently dropped.
 */
export class CreateImprovementSuggestionDto {
  /**
   * Trimmed before validation, then required to be non-empty — so a body
   * of spaces and newlines is a 400 rather than a blank row in the
   * operator's queue. `@MinLength(1)` after the transform rather than
   * `@IsNotEmpty()`: the trim is what makes the check meaningful, and
   * ordering the two the other way round would accept "   ".
   *
   * Deliberately no lower bound above 1. "dark mode" is a real, complete
   * suggestion, and a minimum word count would reject it while doing
   * nothing at all about a child typing "aaaaaaaaaa".
   */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(IMPROVEMENT_SUGGESTION_BODY_MAX_LENGTH)
  body!: string;

  // Capped for the reason IMPROVEMENT_SUGGESTION_VERSION_STRING_MAX_LENGTH
  // spells out: attacker-controllable free text on an authenticated
  // endpoint, exactly like the body.
  @IsString()
  @MaxLength(IMPROVEMENT_SUGGESTION_VERSION_STRING_MAX_LENGTH)
  appVersion!: string;

  // ADR-0014's existing 8-value enum, reused rather than redeclared — the
  // client sends the locale the app is actually rendering in, which is not
  // necessarily the value persisted on `player.locale`.
  @IsEnum(PlayerLocale)
  locale!: PlayerLocale;
}
