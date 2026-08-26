import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A person watches a clip before any stranger can.
 *
 * `docs/design/clip-safety.md`, layer 3 — the highest-value control
 * available and the only one that needs no model. Until now a clip became
 * publicly visible on parental consent alone: the family said yes, and it
 * was in the feed. Consent answers "may this child's video be shared";
 * it cannot answer "is this particular video fit to show strangers",
 * because no parent watched it through our eyes and none should have to.
 *
 * Deliberately modelled on `trainer_post`'s review columns rather than
 * invented: same status/reviewed_at/reviewed_by/rejection_reason shape,
 * so the queue, the console screen and the operator's habits are one
 * thing rather than two that drift.
 *
 * **`published_publicly_at` keeps its exact meaning** — when the CHILD
 * asked for this to be public. It is not overloaded to mean "and it is
 * live", because un-publish, consent revocation and the retention sweep
 * all key on it and all three must keep working unchanged. Visibility
 * becomes the conjunction of the child's request and an operator's yes.
 *
 * NULL status means never requested, which is almost every row.
 */
export class AddPublicClipReview1789200000000 implements MigrationInterface {
  name = 'AddPublicClipReview1789200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public_clip_review_status_enum" AS ENUM('pending', 'approved', 'rejected')`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_clip" ADD "public_review_status" "public_clip_review_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_clip" ADD "public_reviewed_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_clip" ADD "public_reviewed_by_staff_account_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_clip" ADD "public_review_rejection_reason" character varying(300)`,
    );
    // SET NULL, matching trainer_post.reviewed_by_staff_account_id: a
    // reviewer leaving must not delete the evidence that a review
    // happened, and must certainly not cascade away a child's clip.
    await queryRunner.query(
      `ALTER TABLE "video_clip" ADD CONSTRAINT "FK_video_clip_public_reviewer" ` +
        `FOREIGN KEY ("public_reviewed_by_staff_account_id") ` +
        `REFERENCES "staff_account"("id") ON DELETE SET NULL`,
    );
    // The operator's queue is "pending, oldest first" and nothing else.
    // Partial, because the overwhelming majority of rows are NULL.
    await queryRunner.query(
      `CREATE INDEX "IDX_video_clip_public_review_pending" ON "video_clip" ` +
        `("published_publicly_at") WHERE "public_review_status" = 'pending'`,
    );

    // **Existing public clips are grandfathered as approved, not dumped
    // into the queue.** They are already visible and have been through
    // the consent gate; retroactively hiding them would remove a child's
    // published clip without them doing anything wrong, to satisfy a
    // control introduced after the fact. Reviewing them is worth doing —
    // as an operator task, not as an outage.
    await queryRunner.query(
      `UPDATE "video_clip" SET "public_review_status" = 'approved', ` +
        `"public_reviewed_at" = now() ` +
        `WHERE "published_publicly_at" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_video_clip_public_review_pending"`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_clip" DROP CONSTRAINT "FK_video_clip_public_reviewer"`,
    );
    for (const col of [
      'public_review_rejection_reason',
      'public_reviewed_by_staff_account_id',
      'public_reviewed_at',
      'public_review_status',
    ]) {
      await queryRunner.query(`ALTER TABLE "video_clip" DROP COLUMN "${col}"`);
    }
    await queryRunner.query(`DROP TYPE "public_clip_review_status_enum"`);
  }
}
