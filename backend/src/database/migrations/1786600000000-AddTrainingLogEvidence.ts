import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * docs/adr/0025-evidence-tiered-training-points.md — the evidence a
 * training log was paid for.
 *
 * Both columns are additive and defaulted, so every existing row becomes
 * `click_only` with no clip, which is exactly what those logs were: taps.
 * No backfill is needed and no historical points change.
 *
 * `evidence_clip_id` is ON DELETE SET NULL on purpose. Deleting a clip
 * never claws back points already awarded — retroactive removal for a
 * child who deleted a video would make deletion, a right this app makes
 * unconditional, feel costly. The FK goes null; `evidence_tier` preserves
 * what was actually earned.
 */
export class AddTrainingLogEvidence1786600000000 implements MigrationInterface {
  name = 'AddTrainingLogEvidence1786600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "training_log_evidence_tier_enum" AS ENUM (
        'click_only', 'selfie', 'video', 'video_shared_with_team'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "training_log_entry"
        ADD COLUMN "evidence_clip_id" uuid,
        ADD COLUMN "evidence_tier" "training_log_evidence_tier_enum"
          NOT NULL DEFAULT 'click_only'
    `);
    await queryRunner.query(`
      ALTER TABLE "training_log_entry"
        ADD CONSTRAINT "FK_training_log_entry_evidence_clip"
        FOREIGN KEY ("evidence_clip_id") REFERENCES "video_clip"("id")
        ON DELETE SET NULL
    `);
    // Enforces ADR-0025's "one clip verifies one log" rule at the database,
    // not only in the service's pre-check — two concurrent logs racing with
    // the same clip would otherwise both pass that check and both pay out.
    // Partial, so the many NULLs (every click-only log) don't collide.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_training_log_entry_one_log_per_evidence_clip"
        ON "training_log_entry" ("evidence_clip_id")
        WHERE "evidence_clip_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "idx_training_log_entry_one_log_per_evidence_clip"`,
    );
    await queryRunner.query(
      `ALTER TABLE "training_log_entry" DROP CONSTRAINT "FK_training_log_entry_evidence_clip"`,
    );
    await queryRunner.query(
      `ALTER TABLE "training_log_entry" DROP COLUMN "evidence_tier", DROP COLUMN "evidence_clip_id"`,
    );
    await queryRunner.query(`DROP TYPE "training_log_evidence_tier_enum"`);
  }
}
