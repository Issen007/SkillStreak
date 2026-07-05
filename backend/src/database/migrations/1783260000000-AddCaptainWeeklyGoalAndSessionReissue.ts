import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 2 (Kapten & the weekly team goal) — see
// docs/adr/0005-kapten-and-weekly-team-goal.md and
// docs/adr/0004-coach-auth-and-session-reissue.md's Part 3.
//
// Hand-trimmed from the raw `migration:generate` output the same way
// AddConsentToken/InitialSchema were (see their class-level comments): the
// generator re-emits DROP/ADD for every hand-added FK constraint on every
// run, because this project's entities use plain scalar id columns rather
// than TypeORM relation/@JoinColumn decorators. None of that noise is a
// real schema change here — only what's listed below is.
//
// Real changes:
//  1. player.is_captain (boolean, default false) + a partial unique index
//     enforcing at most one active captain per team.
//  2. player.token_version / session_reissue_code / _expires_at
//     (ADR-0004 Part 3).
//  3. challenge.created_by_coach_id renamed to created_by_player_id, FK
//     retargeted from coach.id to player.id (ON DELETE RESTRICT, same as
//     before) — the column never held data (no Challenge CRUD existed
//     before Phase 2), so this is a clean rename, not a data migration.
//  4. challenge.goal_bonus_awarded_at (nullable timestamptz) +
//     challenge.goal_bonus_points_awarded (nullable integer, added after a
//     course correction so a teammate opening the app after the bonus
//     fired can see the exact amount, not a client-side approximation) + a
//     partial unique index enforcing at most one active goal per team.
export class AddCaptainWeeklyGoalAndSessionReissue1783260000000 implements MigrationInterface {
  name = 'AddCaptainWeeklyGoalAndSessionReissue1783260000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- Player: captain flag ------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "player" ADD "is_captain" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_player_one_captain_per_team" ON "player" ("team_id") WHERE "is_captain" = true`,
    );

    // --- Player: session reissue (ADR-0004 Part 3) ---------------------------
    await queryRunner.query(
      `ALTER TABLE "player" ADD "token_version" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "player" ADD "session_reissue_code" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "player" ADD CONSTRAINT "UQ_player_session_reissue_code" UNIQUE ("session_reissue_code")`,
    );
    await queryRunner.query(
      `ALTER TABLE "player" ADD "session_reissue_code_expires_at" TIMESTAMP WITH TIME ZONE`,
    );

    // --- Challenge: created_by_coach_id -> created_by_player_id --------------
    await queryRunner.query(
      `ALTER TABLE "challenge" DROP CONSTRAINT "FK_challenge_created_by_coach"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenge" RENAME COLUMN "created_by_coach_id" TO "created_by_player_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenge" ADD CONSTRAINT "FK_challenge_created_by_player" FOREIGN KEY ("created_by_player_id") REFERENCES "player"("id") ON DELETE RESTRICT`,
    );

    // --- Challenge: goal-completion bonus + one-active-goal-per-team --------
    await queryRunner.query(
      `ALTER TABLE "challenge" ADD "goal_bonus_awarded_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenge" ADD "goal_bonus_points_awarded" integer`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_challenge_one_active_goal_per_team" ON "challenge" ("team_id") WHERE "status" = 'active'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_challenge_one_active_goal_per_team"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenge" DROP COLUMN "goal_bonus_points_awarded"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenge" DROP COLUMN "goal_bonus_awarded_at"`,
    );

    await queryRunner.query(
      `ALTER TABLE "challenge" DROP CONSTRAINT "FK_challenge_created_by_player"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenge" RENAME COLUMN "created_by_player_id" TO "created_by_coach_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenge" ADD CONSTRAINT "FK_challenge_created_by_coach" FOREIGN KEY ("created_by_coach_id") REFERENCES "coach"("id") ON DELETE RESTRICT`,
    );

    await queryRunner.query(
      `ALTER TABLE "player" DROP COLUMN "session_reissue_code_expires_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "player" DROP CONSTRAINT "UQ_player_session_reissue_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "player" DROP COLUMN "session_reissue_code"`,
    );
    await queryRunner.query(`ALTER TABLE "player" DROP COLUMN "token_version"`);

    await queryRunner.query(
      `DROP INDEX "public"."idx_player_one_captain_per_team"`,
    );
    await queryRunner.query(`ALTER TABLE "player" DROP COLUMN "is_captain"`);
  }
}
