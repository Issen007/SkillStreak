import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ADR-0019 Decision 4 — reactions on public clips.
 *
 * Four fixed values and no freeform column anywhere, which is the safety
 * property rather than a schema economy: a closed vocabulary means there
 * is no sentence a reaction can form, so the bullying surface is removed
 * by construction instead of filtered. See `clip-reaction.entity.ts` for
 * why adding a value later is not a routine change.
 *
 * **Both foreign keys are ON DELETE CASCADE, and that is what makes this
 * table need no cleanup code at all.** Every path that already removes a
 * clip or a player — the 90-day retention sweep, uploader self-delete,
 * ADR-0013's account-erasure walk — takes these rows with it. A reaction
 * is derived engagement data (worthless without its clip) and a personal
 * action carrying no accountability weight (unlike `clip_report`, which
 * is an accusation and must outlive its reporter).
 *
 * The unique index is load-bearing rather than an optimisation: the write
 * path UPSERTs on it, so without it a viewer tapping twice quickly would
 * insert two rows and inflate a count the ADR specifically requires not
 * be inflatable.
 */
export class AddClipReactions1788300000000 implements MigrationInterface {
  name = 'AddClipReactions1788300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."clip_reaction_type_enum" AS ENUM('nice', 'strong', 'creative', 'well_done')`,
    );
    await queryRunner.query(
      `CREATE TABLE "clip_reaction" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "clip_id" uuid NOT NULL,
        "player_id" uuid NOT NULL,
        "reaction_type" "public"."clip_reaction_type_enum" NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_clip_reaction" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "clip_reaction" ADD CONSTRAINT "FK_clip_reaction_clip"
       FOREIGN KEY ("clip_id") REFERENCES "video_clip"("id")
       ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "clip_reaction" ADD CONSTRAINT "FK_clip_reaction_player"
       FOREIGN KEY ("player_id") REFERENCES "player"("id")
       ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_clip_reaction_clip_player"
       ON "clip_reaction" ("clip_id", "player_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."UQ_clip_reaction_clip_player"`,
    );
    await queryRunner.query(
      `ALTER TABLE "clip_reaction" DROP CONSTRAINT "FK_clip_reaction_player"`,
    );
    await queryRunner.query(
      `ALTER TABLE "clip_reaction" DROP CONSTRAINT "FK_clip_reaction_clip"`,
    );
    await queryRunner.query(`DROP TABLE "clip_reaction"`);
    await queryRunner.query(`DROP TYPE "public"."clip_reaction_type_enum"`);
  }
}
