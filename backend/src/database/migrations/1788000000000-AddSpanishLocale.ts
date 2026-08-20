import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `es` to `player_locale_enum` (ADR-0014, amended 2026-08-20 at the
 * project owner's request).
 *
 * **Why this is its own migration and not an edit to
 * `1785700000000-AddPlayerLocale`.** That one has run on production. An
 * applied migration is immutable — TypeORM keys the `migrations` table on
 * the class name with no checksum, so editing it in place changes nothing
 * on any database that already ran it while silently diverging from every
 * fresh one. That exact mistake was made and corrected four days ago in
 * `1787900000000-RenameReminderBounceToFailure`; the lesson is cheap to
 * apply and expensive to relearn.
 *
 * `ALTER TYPE ... ADD VALUE` inside a transaction is permitted from
 * PostgreSQL 12 (this project runs 18) with one restriction: the new
 * value may not be *used* in the same transaction. This migration only
 * adds it, so that restriction is satisfied — but it is why nothing here
 * tries to backfill or reference `'es'`.
 *
 * **`down()` deliberately does nothing.** PostgreSQL has no
 * `ALTER TYPE ... DROP VALUE`; reversing this would mean recreating the
 * type and rewriting every column that uses it, which for a value that
 * may already be stored on real player rows is a data-losing operation
 * dressed up as a rollback. An honest no-op with a comment beats a
 * `down()` that would corrupt rows if anyone ever ran it.
 */
export class AddSpanishLocale1788000000000 implements MigrationInterface {
  name = 'AddSpanishLocale1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."player_locale_enum" ADD VALUE IF NOT EXISTS 'es'`,
    );
  }

  public async down(): Promise<void> {
    // Intentionally empty — see the class docstring. Dropping an enum
    // value would require recreating the type and could destroy locale
    // values on live player rows.
  }
}
