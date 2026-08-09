import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ActivityType } from '../activity-type.enum';

// Loose upper bound — a sanity check against fat-fingered/garbage input,
// not a product rule about max session length.
const MAX_DURATION_MINUTES = 8 * 60;

export class CreateTrainingLogDto {
  @IsEnum(ActivityType)
  activityType!: ActivityType;

  @IsInt()
  @Min(1)
  @Max(MAX_DURATION_MINUTES)
  durationMinutes!: number;

  // Accepted now (the column exists per ADR-0002) but not consumed by
  // anything yet — no Challenge-management endpoints exist in Phase 1, per
  // docs/api/phase1-contract.md. Not validated against a real Challenge row
  // for the same reason; do that once Challenge CRUD exists.
  @IsOptional()
  @IsUUID()
  challengeId?: string;

  /**
   * docs/adr/0025 — a published clip offered as proof of this session.
   * Absent means tier 1 (a plain tap), which is exactly today's behaviour
   * and is why this change is backwards compatible.
   */
  @IsOptional()
  @IsUUID()
  evidenceClipId?: string;

  /**
   * Whether the player chose to share that clip with their team, which is
   * the difference between tier 3 and tier 4. Ignored without an
   * `evidenceClipId` — sharing nothing is not a tier.
   */
  @IsOptional()
  @IsBoolean()
  sharedWithTeam?: boolean;
}
