import { MigrationInterface, QueryRunner } from 'typeorm';

// docs/adr/0013-account-erasure.md — self-service GDPR account erasure.
//
// Real changes:
//  1. New `account_erasure_request` table (Decision 1), including a
//     partial unique index enforcing "at most one active (requested/
//     grace_period) row per player_id" — same mechanism/style as
//     idx_player_one_captain_per_team (AddCaptainWeeklyGoalAndSessionReissue).
//     Deliberately no FK on player_id/team_id/successor_player_id — this
//     row must outlive the player/team it's about (see the entity's own
//     comment).
//  2. Three existing `RESTRICT` foreign keys, each added specifically
//     because "no player-deletion feature exists yet" (their own migration
//     comments say so verbatim), now get the real, considered answer
//     ADR-0013 Decision 6 gives them:
//       - challenge.created_by_player_id: RESTRICT -> SET NULL, nullable
//         (anonymize-in-place — a weekly goal is shared team history).
//       - team_chat_message.sender_player_id: RESTRICT -> SET NULL,
//         nullable (anonymize-in-place — preserves the flat chat feed's
//         continuity; content itself is overwritten by application code
//         at erasure time, not by this migration).
//       - video_clip.uploader_player_id: RESTRICT -> CASCADE (a backstop
//         only — the real MinIO object + row deletion always happens
//         explicitly in application code first; Postgres cascade can never
//         reach object storage anyway).
//  3. clip_report.reported_uploader_player_id: CASCADE -> SET NULL,
//     nullable — the project owner's 2026-07-29 decision (ADR-0013's Open
//     Questions #2): a safety report outlives the account it was filed
//     against, mirroring clip_id's own already-established "outlive the
//     thing it reported" pattern.
export class AddAccountErasure1785500000000 implements MigrationInterface {
  name = 'AddAccountErasure1785500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- account_erasure_request (Decision 1) --------------------------------
    await queryRunner.query(
      `CREATE TYPE "public"."account_erasure_request_status_enum" AS ENUM('requested', 'grace_period', 'cancelled', 'executed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "account_erasure_request" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "player_id" uuid NOT NULL, "team_id" uuid NOT NULL, "recipient_contact_snapshot" character varying, "successor_player_id" uuid, "status" "public"."account_erasure_request_status_enum" NOT NULL DEFAULT 'requested', "confirm_code" character varying, "confirm_code_expires_at" TIMESTAMP WITH TIME ZONE, "confirmed_at" TIMESTAMP WITH TIME ZONE, "scheduled_for" TIMESTAMP WITH TIME ZONE, "cancel_code" character varying, "cancelled_at" TIMESTAMP WITH TIME ZONE, "executed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_account_erasure_request_confirm_code" UNIQUE ("confirm_code"), CONSTRAINT "UQ_account_erasure_request_cancel_code" UNIQUE ("cancel_code"), CONSTRAINT "PK_account_erasure_request" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_account_erasure_request_one_active_per_player" ON "account_erasure_request" ("player_id") WHERE "status" IN ('requested', 'grace_period')`,
    );

    // --- challenge.created_by_player_id: RESTRICT -> SET NULL (Decision 6) --
    await queryRunner.query(
      `ALTER TABLE "challenge" DROP CONSTRAINT "FK_challenge_created_by_player"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenge" ALTER COLUMN "created_by_player_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenge" ADD CONSTRAINT "FK_challenge_created_by_player" FOREIGN KEY ("created_by_player_id") REFERENCES "player"("id") ON DELETE SET NULL`,
    );

    // --- team_chat_message.sender_player_id: RESTRICT -> SET NULL -----------
    await queryRunner.query(
      `ALTER TABLE "team_chat_message" DROP CONSTRAINT "FK_team_chat_message_sender"`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_chat_message" ALTER COLUMN "sender_player_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_chat_message" ADD CONSTRAINT "FK_team_chat_message_sender" FOREIGN KEY ("sender_player_id") REFERENCES "player"("id") ON DELETE SET NULL`,
    );

    // --- video_clip.uploader_player_id: RESTRICT -> CASCADE (backstop only) -
    await queryRunner.query(
      `ALTER TABLE "video_clip" DROP CONSTRAINT "FK_video_clip_uploader"`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_clip" ADD CONSTRAINT "FK_video_clip_uploader" FOREIGN KEY ("uploader_player_id") REFERENCES "player"("id") ON DELETE CASCADE`,
    );

    // --- clip_report.reported_uploader_player_id: CASCADE -> SET NULL -------
    await queryRunner.query(
      `ALTER TABLE "clip_report" DROP CONSTRAINT "FK_clip_report_reported_uploader"`,
    );
    await queryRunner.query(
      `ALTER TABLE "clip_report" ALTER COLUMN "reported_uploader_player_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "clip_report" ADD CONSTRAINT "FK_clip_report_reported_uploader" FOREIGN KEY ("reported_uploader_player_id") REFERENCES "player"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "clip_report" DROP CONSTRAINT "FK_clip_report_reported_uploader"`,
    );
    await queryRunner.query(
      `ALTER TABLE "clip_report" ALTER COLUMN "reported_uploader_player_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "clip_report" ADD CONSTRAINT "FK_clip_report_reported_uploader" FOREIGN KEY ("reported_uploader_player_id") REFERENCES "player"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(
      `ALTER TABLE "video_clip" DROP CONSTRAINT "FK_video_clip_uploader"`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_clip" ADD CONSTRAINT "FK_video_clip_uploader" FOREIGN KEY ("uploader_player_id") REFERENCES "player"("id") ON DELETE RESTRICT`,
    );

    await queryRunner.query(
      `ALTER TABLE "team_chat_message" DROP CONSTRAINT "FK_team_chat_message_sender"`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_chat_message" ALTER COLUMN "sender_player_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_chat_message" ADD CONSTRAINT "FK_team_chat_message_sender" FOREIGN KEY ("sender_player_id") REFERENCES "player"("id") ON DELETE RESTRICT`,
    );

    await queryRunner.query(
      `ALTER TABLE "challenge" DROP CONSTRAINT "FK_challenge_created_by_player"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenge" ALTER COLUMN "created_by_player_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenge" ADD CONSTRAINT "FK_challenge_created_by_player" FOREIGN KEY ("created_by_player_id") REFERENCES "player"("id") ON DELETE RESTRICT`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."idx_account_erasure_request_one_active_per_player"`,
    );
    await queryRunner.query(`DROP TABLE "account_erasure_request"`);
    await queryRunner.query(
      `DROP TYPE "public"."account_erasure_request_status_enum"`,
    );
  }
}
