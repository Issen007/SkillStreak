import { MigrationInterface, QueryRunner } from 'typeorm';

// Fas 4 — captain approval for new team joins
// (docs/adr/0009-self-service-team-creation.md's 2026-07-27 addendum).
// Adds Player.team_join_status, a second independent gate alongside the
// existing parental_consent_status — both must be 'approved' before
// training-log/chat/clips access (see assertTeamJoinApproved in each of
// those services).
//
// Existing rows: every player created before this migration already
// passed through the OLD self-service join flow with no captain gate at
// all, so backfilling them all to 'approved' (not 'pending') is the only
// choice that doesn't retroactively lock out real, already-active
// players who never agreed to a gate that didn't exist yet.
export class AddTeamJoinStatus1785131000000 implements MigrationInterface {
  name = 'AddTeamJoinStatus1785131000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."team_join_status_enum" AS ENUM('pending', 'approved', 'rejected')`,
    );
    await queryRunner.query(
      `ALTER TABLE "player" ADD "team_join_status" "public"."team_join_status_enum" NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `UPDATE "player" SET "team_join_status" = 'approved'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "player" DROP COLUMN "team_join_status"`,
    );
    await queryRunner.query(`DROP TYPE "public"."team_join_status_enum"`);
  }
}
