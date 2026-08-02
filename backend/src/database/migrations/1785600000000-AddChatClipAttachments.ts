import { MigrationInterface, QueryRunner } from 'typeorm';

// docs/adr/0017-chat-clip-attachments.md Decision 4 — adds one nullable
// column + a partial index + a single-column FK to `team_chat_message`,
// nothing else. No change to `video_clip`, `clip_report`, or any other
// existing table.
//
// `clip_id` is deliberately a PLAIN single-column FK, not part of a
// composite `(clip_id, team_id)` FK against a new `UNIQUE (id, team_id)` on
// `video_clip` — a composite FK was considered and rejected in the ADR's
// Decision 1: its `ON DELETE SET NULL` would null out every column in the
// FK together, including `team_id`, which would wipe the *message's own*
// team scoping whenever the referenced clip is hard-deleted (self-delete or
// the 90-day retention sweep, both unconditional per ADR-0010 Decision 5).
// Team-scoping for this reference is instead enforced in application code,
// at two independent layers (TeamChatService.postMessage's write-time
// loaded-row check, and the read-time join predicate in listMessages) — see
// the ADR, don't "fix" this into a composite FK.
export class AddChatClipAttachments1785600000000 implements MigrationInterface {
  name = 'AddChatClipAttachments1785600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "team_chat_message" ADD "clip_id" uuid`,
    );
    // Partial index: only the (expected to be small) subset of messages
    // that carry an attachment ever need this lookup path.
    await queryRunner.query(
      `CREATE INDEX "IDX_team_chat_message_clip_id" ON "team_chat_message" ("clip_id") WHERE "clip_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_chat_message" ADD CONSTRAINT "FK_team_chat_message_clip" FOREIGN KEY ("clip_id") REFERENCES "video_clip"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "team_chat_message" DROP CONSTRAINT "FK_team_chat_message_clip"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_team_chat_message_clip_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_chat_message" DROP COLUMN "clip_id"`,
    );
  }
}
