import { MigrationInterface, QueryRunner } from 'typeorm';

// Fas 3 (video clips & the team feed) — docs/adr/0010-video-storage-and-
// serving.md.
//
// Real changes:
//  1. video_clip — the clip's metadata row (bytes live in MinIO, see
//     ObjectStorageService). team_id/uploader_player_id denormalized at
//     upload time (same pattern as team_chat_message). Indexed on
//     (team_id, status, created_at) for the feed query, and separately on
//     (status, expires_at) for the daily retention sweep.
//  2. clip_report — append-only report audit trail. clip_id is nullable,
//     ON DELETE SET NULL (unlike team_chat_message_report's message_id,
//     which cascades) — a report must outlive the clip it reported
//     (self-delete/expiry), per ADR-0010 Decision 5.
// The two unique indexes are hand-named (not the generator's auto-hashed
// names) for the same reason AddTeamChat's are: VideoClipsService's
// isPostgresUniqueViolation(error, constraintName) calls need a stable,
// predictable name to check against.
export class AddVideoClips1783700000000 implements MigrationInterface {
  name = 'AddVideoClips1783700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- video_clip -----------------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "public"."video_clip_status_enum" AS ENUM('pending_upload', 'published', 'hidden')`,
    );
    await queryRunner.query(
      `CREATE TABLE "video_clip" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "team_id" uuid NOT NULL,
        "uploader_player_id" uuid NOT NULL,
        "tagged_player_id" uuid,
        "storage_key" character varying NOT NULL,
        "mime_type" character varying NOT NULL,
        "file_size_bytes" integer NOT NULL,
        "duration_seconds" integer NOT NULL,
        "caption" character varying(140),
        "status" "public"."video_clip_status_enum" NOT NULL DEFAULT 'pending_upload',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "expires_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "UQ_video_clip_storage_key" UNIQUE ("storage_key"),
        CONSTRAINT "PK_video_clip" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_video_clip_team_status_created_at" ON "video_clip" ("team_id", "status", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_video_clip_status_expires_at" ON "video_clip" ("status", "expires_at")`,
    );

    // --- clip_report ------------------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "public"."clip_report_reason_enum" AS ENUM('appears_without_consent', 'inappropriate_content', 'not_training_related', 'bullying', 'other')`,
    );
    await queryRunner.query(
      `CREATE TABLE "clip_report" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "clip_id" uuid,
        "reporter_player_id" uuid NOT NULL,
        "reported_uploader_player_id" uuid NOT NULL,
        "reason" "public"."clip_report_reason_enum" NOT NULL,
        "note" character varying(140),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_clip_report" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_clip_report_clip_reporter" ON "clip_report" ("clip_id", "reporter_player_id")`,
    );

    // --- Foreign keys -----------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "video_clip" ADD CONSTRAINT "FK_video_clip_team" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE`,
    );
    // RESTRICT: same precedent as team_chat_message.sender_player_id — no
    // player-deletion feature exists yet, so don't silently orphan a clip
    // by allowing its uploader to be deleted out from under it.
    await queryRunner.query(
      `ALTER TABLE "video_clip" ADD CONSTRAINT "FK_video_clip_uploader" FOREIGN KEY ("uploader_player_id") REFERENCES "player"("id") ON DELETE RESTRICT`,
    );
    // SET NULL: a stale "tag a teammate" reference is fine to just clear —
    // unlike the uploader, the clip's own existence never depended on it.
    await queryRunner.query(
      `ALTER TABLE "video_clip" ADD CONSTRAINT "FK_video_clip_tagged_player" FOREIGN KEY ("tagged_player_id") REFERENCES "player"("id") ON DELETE SET NULL`,
    );
    // SET NULL (ADR-0010 Decision 5) — the report must survive the clip's
    // own deletion (self-delete/expiry); reported_uploader_player_id is
    // denormalized above for exactly that reason.
    await queryRunner.query(
      `ALTER TABLE "clip_report" ADD CONSTRAINT "FK_clip_report_clip" FOREIGN KEY ("clip_id") REFERENCES "video_clip"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "clip_report" ADD CONSTRAINT "FK_clip_report_reporter" FOREIGN KEY ("reporter_player_id") REFERENCES "player"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "clip_report" ADD CONSTRAINT "FK_clip_report_reported_uploader" FOREIGN KEY ("reported_uploader_player_id") REFERENCES "player"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "clip_report" DROP CONSTRAINT "FK_clip_report_reported_uploader"`,
    );
    await queryRunner.query(
      `ALTER TABLE "clip_report" DROP CONSTRAINT "FK_clip_report_reporter"`,
    );
    await queryRunner.query(
      `ALTER TABLE "clip_report" DROP CONSTRAINT "FK_clip_report_clip"`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_clip" DROP CONSTRAINT "FK_video_clip_tagged_player"`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_clip" DROP CONSTRAINT "FK_video_clip_uploader"`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_clip" DROP CONSTRAINT "FK_video_clip_team"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."UQ_clip_report_clip_reporter"`,
    );
    await queryRunner.query(`DROP TABLE "clip_report"`);
    await queryRunner.query(`DROP TYPE "public"."clip_report_reason_enum"`);

    await queryRunner.query(
      `DROP INDEX "public"."IDX_video_clip_status_expires_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_video_clip_team_status_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "video_clip"`);
    await queryRunner.query(`DROP TYPE "public"."video_clip_status_enum"`);
  }
}
