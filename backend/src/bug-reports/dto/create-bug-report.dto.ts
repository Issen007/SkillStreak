import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PlayerLocale } from '../../common/locale/player-locale.enum';
import {
  BUG_REPORT_DESCRIPTION_MAX_LENGTH,
  BUG_REPORT_VERSION_STRING_MAX_LENGTH,
} from '../bug-reports.constants';
import {
  BugReportCategory,
  BugReportPlatform,
  BugReportScreen,
} from '../entities/bug-report.entity';

/**
 * docs/adr/0022-admin-control-center.md Decision 7's capture allow-list,
 * expressed as a DTO — the boundary where "a fixed, allow-listed set" stops
 * being prose and starts being enforced.
 *
 * **Every enum field is `@IsEnum`, never a bare `@IsString`.** That is the
 * 2026-08-02 security-reviewer correction applied at the second of its two
 * layers (the first being the Postgres enum itself): `screen` in particular
 * was called out by name, and the correction's stated minimum fallback was
 * an explicit `@IsIn([...])` — "never an unconstrained string". A real enum
 * validator is the stronger version of that.
 *
 * **What has no field here, and so cannot be sent at all**: any location
 * value (CLAUDE.md's non-negotiable), a device identifier or advertising
 * id, an IP address, a recent-action trail, a screenshot, a log attachment,
 * and `playerId` — which the server takes from the session
 * (`CurrentPlayerId`) and never from the body. `main.ts`'s global
 * `ValidationPipe` runs with `whitelist: true, forbidNonWhitelisted: true`,
 * so a client sending any of those gets a 400 rather than having it
 * silently dropped.
 */
export class CreateBugReportDto {
  @IsEnum(BugReportCategory)
  category!: BugReportCategory;

  // Player-picked, not auto-captured — see BugReportScreen's own docstring
  // and docs/design/phase7-admin-console-flows.md §9.3.
  @IsEnum(BugReportScreen)
  screen!: BugReportScreen;

  // Genuinely optional (§9.2: "demanding writing from a nine-year-old
  // suppresses reports"). A whitespace-only description trims to '' and is
  // treated as "no description", not a validation error — same posture as
  // CreateUploadUrlDto's optional clip caption, and the reason §6.5's
  // `report-with-no-description` state omits the block entirely rather than
  // rendering an empty one.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  })
  @IsString()
  @MaxLength(BUG_REPORT_DESCRIPTION_MAX_LENGTH)
  description?: string;

  // Capped for the reason BUG_REPORT_VERSION_STRING_MAX_LENGTH spells out:
  // this is attacker-controllable free text on an authenticated endpoint,
  // exactly like `description`, and the 2026-08-02 correction's whole point
  // was that the original draft treated it as if it weren't.
  @IsString()
  @MaxLength(BUG_REPORT_VERSION_STRING_MAX_LENGTH)
  appVersion!: string;

  @IsEnum(BugReportPlatform)
  platform!: BugReportPlatform;

  @IsOptional()
  @IsString()
  @MaxLength(BUG_REPORT_VERSION_STRING_MAX_LENGTH)
  osVersion?: string;

  // ADR-0014's existing 8-value enum, reused rather than redeclared — the
  // client sends the locale the app is actually rendering in, which is not
  // necessarily the value persisted on `player.locale` (a child can change
  // language mid-session), so it's captured per report.
  @IsEnum(PlayerLocale)
  locale!: PlayerLocale;
}
