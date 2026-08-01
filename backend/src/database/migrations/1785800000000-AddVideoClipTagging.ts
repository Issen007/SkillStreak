import { MigrationInterface, QueryRunner } from 'typeorm';

// docs/adr/0018-ai-video-content-tagging.md Decision 4 (table) and Decision
// 5's schema-only piece (the `video_clip.tagging_status` column). Additive
// only — no change to any existing column, index, or FK on `video_clip` or
// `clip_report`. Schema-only: no service/job/queue consumes either of these
// yet (see the ADR's Status section for what's still gated on infra
// requirements before the classification service itself is built).
//
// video_clip_tag: a new table, not a column, because a clip can carry
// zero-to-several tags (same normalized-table precedent as clip_report,
// not embedded JSON). `clip_id` is ON DELETE CASCADE — deliberately
// different from clip_report.clip_id's ON DELETE SET NULL — because a tag
// is pure derived enrichment about a clip's content with no independent
// value once the clip is gone, unlike a report (an accountability record
// about a person's action that must outlive the clip it reported). This
// means the 90-day retention sweep, uploader self-delete, and the
// account-erasure walk (ADR-0013) all take a clip's tags with them for
// free, with no new code path.
//
// video_clip.tagging_status: tracks the (not-yet-built) auto-tagging job's
// outcome only; defaults every existing and new row to 'not_processed', and
// never affects playback/feed visibility/any user-facing state.
export class AddVideoClipTagging1785800000000 implements MigrationInterface {
  name = 'AddVideoClipTagging1785800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- video_clip.tagging_status ---------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "public"."video_clip_tagging_status_enum" AS ENUM('not_processed', 'tagged', 'no_confident_tags', 'failed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_clip" ADD "tagging_status" "public"."video_clip_tagging_status_enum" NOT NULL DEFAULT 'not_processed'`,
    );

    // --- video_clip_tag ----------------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "public"."video_clip_tag_tag_enum" AS ENUM('shooting', 'stickhandling', 'passing', 'fitness_conditioning', 'goalkeeping', 'team_drill', 'other_training', 'unclear_or_unrelated')`,
    );
    await queryRunner.query(
      `CREATE TABLE "video_clip_tag" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "clip_id" uuid NOT NULL,
        "tag" "public"."video_clip_tag_tag_enum" NOT NULL,
        "confidence" numeric(4,3) NOT NULL,
        "source" character varying NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_video_clip_tag" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_video_clip_tag_confidence_range" CHECK ("confidence" >= 0 AND "confidence" <= 1)
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_video_clip_tag_clip_id" ON "video_clip_tag" ("clip_id")`,
    );
    // ON DELETE CASCADE — see file header; deliberately not clip_report's
    // ON DELETE SET NULL pattern.
    await queryRunner.query(
      `ALTER TABLE "video_clip_tag" ADD CONSTRAINT "FK_video_clip_tag_clip" FOREIGN KEY ("clip_id") REFERENCES "video_clip"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "video_clip_tag" DROP CONSTRAINT "FK_video_clip_tag_clip"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_video_clip_tag_clip_id"`);
    await queryRunner.query(`DROP TABLE "video_clip_tag"`);
    await queryRunner.query(`DROP TYPE "public"."video_clip_tag_tag_enum"`);

    await queryRunner.query(
      `ALTER TABLE "video_clip" DROP COLUMN "tagging_status"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."video_clip_tagging_status_enum"`,
    );
  }
}
