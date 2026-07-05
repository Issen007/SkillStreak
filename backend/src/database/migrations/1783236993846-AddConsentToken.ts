import { MigrationInterface, QueryRunner } from 'typeorm';

// Hand-trimmed from the raw `migration:generate` output: the generator
// also emitted DROP/ADD for every hand-added FK constraint and a rebuild of
// two unrelated enum types, because (per InitialSchema's class-level
// comment) this project's entities use plain scalar id columns rather than
// TypeORM relation/@JoinColumn decorators, so the generator can't see those
// FKs and treats them as drift on every run. None of that noise is a real
// schema change here — only the two new nullable columns + unique
// constraint on "player" are.
export class AddConsentToken1783236993846 implements MigrationInterface {
  name = 'AddConsentToken1783236993846';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "player" ADD "consent_token" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "player" ADD CONSTRAINT "UQ_23405d43f6ad6511b655028fc81" UNIQUE ("consent_token")`,
    );
    await queryRunner.query(
      `ALTER TABLE "player" ADD "consent_token_expires_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "player" DROP COLUMN "consent_token_expires_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "player" DROP CONSTRAINT "UQ_23405d43f6ad6511b655028fc81"`,
    );
    await queryRunner.query(`ALTER TABLE "player" DROP COLUMN "consent_token"`);
  }
}
