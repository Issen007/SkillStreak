import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum ChallengeStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

// Reused as "this week's team goal" ("veckans mål") in Phase 2, per
// docs/adr/0005-kapten-and-weekly-team-goal.md Decision 2 — the entity/
// table name deliberately stays Challenge/challenge (the Phase 2 product
// language lives in the API route/UI copy, not the schema); a
// service/controller now exists (see src/weekly-goal/). Progress against a
// goal is computed live, team-wide, from TrainingLogEntry — no
// challenge_id tagging is used for this feature (see that ADR).
@Entity('challenge')
export class Challenge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'team_id', type: 'uuid' })
  teamId!: string;

  // Renamed from created_by_coach_id (Phase 1 held no data in this column —
  // no Challenge CRUD existed before Phase 2) — the creator is now always a
  // player (specifically, whoever was captain at creation time), per
  // ADR-0005 Decision 1/2. FK retargeted to player.id, ON DELETE RESTRICT:
  // don't silently orphan a goal by deleting the player who authored it.
  @Column({ name: 'created_by_player_id', type: 'uuid' })
  createdByPlayerId!: string;

  @Column({ type: 'varchar' })
  title!: string;

  @Column({ type: 'varchar' })
  description!: string;

  // Unchanged shape (plain varchar, not a DB enum) — validated against the
  // fixed 5-value preset at the DTO boundary
  // (see src/weekly-goal/dto/*.dto.ts), same pattern as
  // BadgeAwardContext.triggerReason.
  @Column({ name: 'target_metric', type: 'varchar' })
  targetMetric!: string;

  @Column({ name: 'target_value', type: 'integer' })
  targetValue!: number;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate!: string;

  @Column({
    type: 'enum',
    enum: ChallengeStatus,
    enumName: 'challenge_status_enum',
    default: ChallengeStatus.DRAFT,
  })
  status!: ChallengeStatus;

  // NEW — ADR-0005 Decision 3: the idempotency flag for the one-time
  // goal-completion bonus. Set (together with goal_bonus_points_awarded,
  // below) under the same row lock used to detect the crossing, inside
  // TrainingLogsService.logTraining's transaction — see
  // WeeklyGoalService.processGoalBonusForLog. Never cleared once set (the
  // bonus is never clawed back, same precedent as a BadgeAward).
  @Column({
    name: 'goal_bonus_awarded_at',
    type: 'timestamptz',
    nullable: true,
  })
  goalBonusAwardedAt!: Date | null;

  // NEW, added after a course correction during Phase 2 implementation
  // (not in ADR-0005's original text): the exact lump-sum amount awarded
  // (5 + team-wide progress minutes *at the moment of crossing*). A
  // teammate who opens the app after the bonus already fired needs the
  // real number, not a client-side approximation — `5 + targetValue` would
  // systematically undercount it, since the crossing log almost never
  // lands exactly on the threshold. Set in the same statement/transaction/
  // row-lock as goal_bonus_awarded_at, never recomputed after the fact.
  @Column({
    name: 'goal_bonus_points_awarded',
    type: 'integer',
    nullable: true,
  })
  goalBonusPointsAwarded!: number | null;
}
