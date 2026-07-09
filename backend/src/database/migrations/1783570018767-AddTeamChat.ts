import { MigrationInterface, QueryRunner } from 'typeorm';

// Fas 2.6b (team chat) — docs/adr/0007-team-chat.md.
//
// Hand-trimmed from the raw `migration:generate` output the same way every
// prior migration in this project has been (see InitialSchema/
// AddCaptainWeeklyGoalAndSessionReissue's class comments): the generator
// re-emits DROP/ADD for every hand-added FK constraint on every run (this
// project's entities use plain scalar id columns, not TypeORM relation/
// @JoinColumn decorators) plus some unrelated enum-type churn on
// team_season_pot_status_enum/challenge_status_enum — none of that is a
// real schema change here.
//
// Real changes:
//  1. team_chat_message — the message itself (team_id/sender_player_id/
//     content/status), indexed on (team_id, created_at) for the poll query.
//  2. team_chat_block — per-viewer mute, unique on (blocker_player_id,
//     blocked_player_id) so a repeat block is cheap to detect as a no-op.
//  3. team_chat_message_report — append-only report audit trail, unique on
//     (message_id, reporter_player_id) so a second report of the same
//     message by the same player is a domain-level conflict, not a fresh
//     row.
// The two unique indexes are hand-named (UQ_team_chat_block_blocker_
// blocked / UQ_team_chat_message_report_message_reporter, not the
// generator's auto-hashed names) because TeamChatService's
// isPostgresUniqueViolation(error, constraintName) calls need a stable,
// predictable name to check against — same reasoning
// AddCaptainWeeklyGoalAndSessionReissue already applied to
// UQ_player_session_reissue_code. Created as named UNIQUE INDEXes (not
// ALTER TABLE ... ADD CONSTRAINT ... UNIQUE) to match the entities' own
// named @Index(..., { unique: true }) decorators exactly, so a future
// `migration:generate` run sees no drift on these two.
export class AddTeamChat1783570018767 implements MigrationInterface {
  name = 'AddTeamChat1783570018767';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- team_chat_message ---------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "public"."team_chat_message_status_enum" AS ENUM('visible', 'hidden')`,
    );
    await queryRunner.query(
      `CREATE TABLE "team_chat_message" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "team_id" uuid NOT NULL, "sender_player_id" uuid NOT NULL, "content" character varying(500) NOT NULL, "status" "public"."team_chat_message_status_enum" NOT NULL DEFAULT 'visible', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0b7e01fbb8994d77c9e31e30542" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_team_chat_message_team_created_at" ON "team_chat_message" ("team_id", "created_at") `,
    );

    // --- team_chat_block -------------------------------------------------------
    await queryRunner.query(
      `CREATE TABLE "team_chat_block" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "blocker_player_id" uuid NOT NULL, "blocked_player_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0cb145ed4737cbb927e4ed4665e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_team_chat_block_blocker_blocked" ON "team_chat_block" ("blocker_player_id", "blocked_player_id")`,
    );

    // --- team_chat_message_report ----------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "public"."team_chat_message_report_reason_enum" AS ENUM('bullying', 'inappropriate_language', 'spam', 'other')`,
    );
    await queryRunner.query(
      `CREATE TABLE "team_chat_message_report" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "message_id" uuid NOT NULL, "reporter_player_id" uuid NOT NULL, "reason" "public"."team_chat_message_report_reason_enum" NOT NULL, "note" character varying(140), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d059f1ccb12433b7267583d5cb5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_team_chat_message_report_message_reporter" ON "team_chat_message_report" ("message_id", "reporter_player_id")`,
    );

    // --- Foreign keys (hand-added, see class-level comment) -----------------
    await queryRunner.query(
      `ALTER TABLE "team_chat_message" ADD CONSTRAINT "FK_team_chat_message_team" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE`,
    );
    // RESTRICT: same precedent as Challenge.created_by_player_id — don't
    // silently orphan a message by deleting the player who sent it (no
    // player-deletion feature exists yet either).
    await queryRunner.query(
      `ALTER TABLE "team_chat_message" ADD CONSTRAINT "FK_team_chat_message_sender" FOREIGN KEY ("sender_player_id") REFERENCES "player"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_chat_block" ADD CONSTRAINT "FK_team_chat_block_blocker" FOREIGN KEY ("blocker_player_id") REFERENCES "player"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_chat_block" ADD CONSTRAINT "FK_team_chat_block_blocked" FOREIGN KEY ("blocked_player_id") REFERENCES "player"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_chat_message_report" ADD CONSTRAINT "FK_team_chat_message_report_message" FOREIGN KEY ("message_id") REFERENCES "team_chat_message"("id") ON DELETE CASCADE`,
    );
    // CASCADE, same precedent as ParentalConsentRecord.player_id — another
    // append-only, player-tied audit trail.
    await queryRunner.query(
      `ALTER TABLE "team_chat_message_report" ADD CONSTRAINT "FK_team_chat_message_report_reporter" FOREIGN KEY ("reporter_player_id") REFERENCES "player"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "team_chat_message_report" DROP CONSTRAINT "FK_team_chat_message_report_reporter"`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_chat_message_report" DROP CONSTRAINT "FK_team_chat_message_report_message"`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_chat_block" DROP CONSTRAINT "FK_team_chat_block_blocked"`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_chat_block" DROP CONSTRAINT "FK_team_chat_block_blocker"`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_chat_message" DROP CONSTRAINT "FK_team_chat_message_sender"`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_chat_message" DROP CONSTRAINT "FK_team_chat_message_team"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."UQ_team_chat_message_report_message_reporter"`,
    );
    await queryRunner.query(`DROP TABLE "team_chat_message_report"`);
    await queryRunner.query(
      `DROP TYPE "public"."team_chat_message_report_reason_enum"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."UQ_team_chat_block_blocker_blocked"`,
    );
    await queryRunner.query(`DROP TABLE "team_chat_block"`);

    await queryRunner.query(
      `DROP INDEX "public"."IDX_team_chat_message_team_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "team_chat_message"`);
    await queryRunner.query(
      `DROP TYPE "public"."team_chat_message_status_enum"`,
    );
  }
}
