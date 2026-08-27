import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What an operator decided about a reported clip.
 *
 * `docs/design/clip-safety.md` layer 4. The front half has worked since
 * ADR-0010 Decision 4: one report hides a clip instantly, with no
 * threshold and no quorum. The back half did not exist — no queue, no
 * record of any decision, and **no way to put back a clip reported in
 * error**, which made "report" a one-way door operated by any teammate.
 *
 * **A separate table rather than more columns on `video_clip`, and rather
 * than fields on `clip_report`.** Both alternatives were considered:
 *
 * - `clip_report` is deliberately append-only (its own docstring calls it
 *   an audit trail). Adding `resolved_at` to it would break that, and it
 *   is the wrong grain anyway — several teammates can report one clip,
 *   and the decision is about the clip, not about each report.
 * - Columns on `video_clip` would flatten this to one decision per clip
 *   forever. A clip can be reported, dismissed, and reported again by
 *   someone else with a better reason; each of those is a separate
 *   judgement and the earlier one must not be overwritten.
 *
 * So decisions are events, and this table is their history.
 *
 * Both foreign keys are ON DELETE SET NULL for the same reason
 * `clip_report` already uses it: the record that a judgement was made
 * must outlive the clip it was about and the operator who made it.
 */
export class AddClipModerationDecision1789300000000 implements MigrationInterface {
  name = 'AddClipModerationDecision1789300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "clip_moderation_decision_kind_enum" AS ENUM('upheld', 'dismissed')`,
    );
    await queryRunner.query(`
      CREATE TABLE "clip_moderation_decision" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "clip_id" uuid,
        "decided_by_staff_account_id" uuid,
        "decision" "clip_moderation_decision_kind_enum" NOT NULL,
        "note" character varying(300),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_clip_moderation_decision" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "clip_moderation_decision" ADD CONSTRAINT "FK_clip_moderation_decision_clip" ` +
        `FOREIGN KEY ("clip_id") REFERENCES "video_clip"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "clip_moderation_decision" ADD CONSTRAINT "FK_clip_moderation_decision_staff" ` +
        `FOREIGN KEY ("decided_by_staff_account_id") REFERENCES "staff_account"("id") ON DELETE SET NULL`,
    );
    // The queue asks "what is the newest decision for this clip", so the
    // index is per clip, newest first.
    await queryRunner.query(
      `CREATE INDEX "IDX_clip_moderation_decision_clip" ON "clip_moderation_decision" ("clip_id", "created_at" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "clip_moderation_decision"`);
    await queryRunner.query(`DROP TYPE "clip_moderation_decision_kind_enum"`);
  }
}
