import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * How long a trainer's tip takes to do.
 *
 * The one field that separates a *tip* from a *drill*, and the project
 * owner's 2026-08-26 ask was for trainers to publish drills. Everything
 * else a drill needs — age band, focus, title, body, author — the table
 * already had; only "15 minutes" was missing, and it is the first thing
 * anyone looking for a session filters on.
 *
 * **Deliberately a column here rather than a new `SharedDrill` table.**
 * ADR-0029 Decision 2's prize is that no drill row exists for any query
 * in this app to join to a `player`, `team`, `video_clip` or
 * `training_log_entry` — the rule is unrepresentable rather than
 * forbidden. `trainer_post` has no such column either, so publishing
 * drills through it keeps that property intact; a drill table would have
 * spent it for nothing, since the review pipeline and the app-wide feed
 * both already exist here.
 *
 * Nullable, because every existing row predates it and a tip that is not
 * a timed session genuinely has no duration. `smallint` matches
 * `training_log_entry.duration_minutes`, which is the same quantity in
 * the same units.
 */
export class AddTrainerPostDuration1789100000000 implements MigrationInterface {
  name = 'AddTrainerPostDuration1789100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trainer_post" ADD "duration_minutes" smallint`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trainer_post" DROP COLUMN "duration_minutes"`,
    );
  }
}
