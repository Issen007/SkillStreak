import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ADR-0035 Decision 3 — where a trainer post's text came from.
 *
 * Non-null means the post began life as a model draft
 * (`training_plan_draft`) rather than as something a trainer typed. One
 * column, because that is the whole of what provenance needs to record:
 * the draft itself already holds the prompt, the age band and the
 * generated text.
 *
 * **`ON DELETE SET NULL`, deliberately, and this is the load-bearing
 * choice.** ADR-0028 Decision 7's sweep deletes old drafts, and a
 * published post must not disappear when its source ages out — the post
 * is the thing children read, and it outlives the draft by design. Same
 * reasoning `reviewed_by_staff_account_id` on this table already carries:
 * evidence about a row must survive the deletion of what it points at.
 *
 * The column's real consumer is the operator review screen. A reviewer
 * working a queue reads human-written and machine-drafted text
 * differently and should be able to tell which is which — hiding the
 * distinction would degrade the one control standing between this and a
 * child's screen (ADR-0035 Decision 3).
 */
export class AddTrainerPostPlanProvenance1789000000000 implements MigrationInterface {
  name = 'AddTrainerPostPlanProvenance1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trainer_post" ADD "source_training_plan_draft_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "trainer_post" ADD CONSTRAINT "FK_trainer_post_source_plan_draft" ` +
        `FOREIGN KEY ("source_training_plan_draft_id") ` +
        `REFERENCES "training_plan_draft"("id") ON DELETE SET NULL`,
    );
    // The review screen filters on it ("show me the machine-drafted ones"),
    // and it is null for most rows, so a partial index is both smaller and
    // the one that actually gets used.
    await queryRunner.query(
      `CREATE INDEX "IDX_trainer_post_source_plan_draft" ON "trainer_post" ` +
        `("source_training_plan_draft_id") WHERE "source_training_plan_draft_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_trainer_post_source_plan_draft"`);
    await queryRunner.query(
      `ALTER TABLE "trainer_post" DROP CONSTRAINT "FK_trainer_post_source_plan_draft"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trainer_post" DROP COLUMN "source_training_plan_draft_id"`,
    );
  }
}
