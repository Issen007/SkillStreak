import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `co_owner` to `event_registration_interest_enum` — the signup
 * form's new "I want to join the journey as a co-owner" option.
 *
 * Its own migration rather than an edit to the one that created the type,
 * for the reason that cost this project a day last week: TypeORM keys the
 * `migrations` table on the class name with no checksum, so editing an
 * applied migration changes nothing on any database that already ran it
 * while silently diverging from every fresh one.
 *
 * `ALTER TYPE … ADD VALUE` runs inside a transaction from PostgreSQL 12
 * (this project runs 18) provided the new value is not *used* in the same
 * transaction — which is why this only adds it and backfills nothing.
 *
 * `down()` is deliberately a no-op: PostgreSQL has no
 * `ALTER TYPE … DROP VALUE`, and reversing this would mean recreating the
 * type and rewriting every column using it — a data-losing operation
 * dressed up as a rollback, on a table that may by then hold real
 * expressions of interest in owning part of the company.
 */
export class AddCoOwnerInterest1788200000000 implements MigrationInterface {
  name = 'AddCoOwnerInterest1788200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."event_registration_interest_enum" ADD VALUE IF NOT EXISTS 'co_owner'`,
    );
  }

  public async down(): Promise<void> {
    // Intentionally empty — see the class docstring.
  }
}
