import { MigrationInterface, QueryRunner } from 'typeorm';

// The lease columns that let the GPU cluster PULL tagging work instead of
// the app cluster pushing it (owner's decision 2026-08-12, option 2 in
// docs/design/gpu-video-tagging-architecture.md's "The route").
//
// `tagging_status` already exists from the schema-only ADR-0018 change,
// which explicitly said a background job would consume it and that an
// index should be added "alongside whatever job is built". This is that
// job, so this is that index.
//
// The lease exists because the worker is remote, unreliable and may die
// mid-clip. Three columns, each earning its place:
//
//  - `tagging_lease_id` — a random uuid handed to the worker INSTEAD of
//    the clip id. The worker never learns which clip it is looking at, so
//    a compromised worker (or its logs) holds no identifier that means
//    anything in this database. This is the single most important column
//    here.
//  - `tagging_leased_until` — a claim that expires. A worker that dies
//    holding a lease releases it by doing nothing, with no reaper job.
//  - `tagging_attempts` — so a clip that kills the worker every time is
//    eventually marked `failed` rather than retried forever.
export class AddClipTaggingLease1787300000000 implements MigrationInterface {
  name = 'AddClipTaggingLease1787300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "video_clip"
        ADD COLUMN "tagging_attempts" smallint NOT NULL DEFAULT 0,
        ADD COLUMN "tagging_lease_id" uuid,
        ADD COLUMN "tagging_leased_until" TIMESTAMP WITH TIME ZONE
    `);

    // One lease id is live at a time, and a result can only be posted
    // against a lease that exists. Unique so a replayed or guessed result
    // cannot be applied to two clips.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_video_clip_tagging_lease_id"
        ON "video_clip" ("tagging_lease_id")
        WHERE "tagging_lease_id" IS NOT NULL
    `);

    // The sweep's exact query: published, not yet processed, not currently
    // leased. Partial, because the rows that match are a small and
    // shrinking fraction of the table and there is no reason to index the
    // ones that never will.
    await queryRunner.query(`
      CREATE INDEX "IDX_video_clip_tagging_pending"
        ON "video_clip" ("created_at")
        WHERE "tagging_status" = 'not_processed' AND "status" = 'published'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_video_clip_tagging_pending"`);
    await queryRunner.query(`DROP INDEX "IDX_video_clip_tagging_lease_id"`);
    await queryRunner.query(`
      ALTER TABLE "video_clip"
        DROP COLUMN "tagging_leased_until",
        DROP COLUMN "tagging_lease_id",
        DROP COLUMN "tagging_attempts"
    `);
  }
}
