import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ADR-0019 Decision 6's Sparade — the one new entity Phase 6 adds.
 *
 * Deliberately holds a pointer and nothing else: no title, no thumbnail,
 * no cached screen name. Decision 6 requires the archive to re-check
 * publication status at fetch time, and any denormalised copy here would
 * be a private snapshot of another child's video that outlived their
 * decision to withdraw it.
 *
 * Both foreign keys cascade, so an un-published-then-swept clip, or a
 * player who erases their account, takes their bookmarks with them and
 * there is nothing to sweep separately.
 */
export class AddClipBookmarks1788400000000 implements MigrationInterface {
  name = 'AddClipBookmarks1788400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "clip_bookmark" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "clip_id" uuid NOT NULL,
        "player_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_clip_bookmark" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "clip_bookmark" ADD CONSTRAINT "FK_clip_bookmark_clip"
       FOREIGN KEY ("clip_id") REFERENCES "video_clip"("id")
       ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "clip_bookmark" ADD CONSTRAINT "FK_clip_bookmark_player"
       FOREIGN KEY ("player_id") REFERENCES "player"("id")
       ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_clip_bookmark_clip_player"
       ON "clip_bookmark" ("clip_id", "player_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."UQ_clip_bookmark_clip_player"`,
    );
    await queryRunner.query(
      `ALTER TABLE "clip_bookmark" DROP CONSTRAINT "FK_clip_bookmark_player"`,
    );
    await queryRunner.query(
      `ALTER TABLE "clip_bookmark" DROP CONSTRAINT "FK_clip_bookmark_clip"`,
    );
    await queryRunner.query(`DROP TABLE "clip_bookmark"`);
  }
}
