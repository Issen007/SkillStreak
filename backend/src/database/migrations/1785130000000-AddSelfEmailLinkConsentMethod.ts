import { MigrationInterface, QueryRunner } from 'typeorm';

// Fas 4 age-banded self-verification (13+, email only, no parent) —
// docs/adr/0002-data-model.md addendum §2 already anticipated this exact
// extension point ("the mechanism (email_link vs. in_app_by_parent_
// account) already anticipates it"). Adds a third ConsentMethod value so
// ParentalConsentRecord's audit trail can distinguish "a parent clicked
// this" from "the player verified their own account" — everything else
// about the consent state machine (pending -> approved, the token/expiry
// columns, the gameplay gate) is unchanged.
//
// ALTER TYPE ... ADD VALUE runs fine inside TypeORM's default migration
// transaction in Postgres 12+ as long as the new value isn't also *used*
// in that same transaction (it isn't — this migration only adds it).
//
// down() uses the standard Postgres workaround for removing an enum
// value (no native DROP VALUE exists): swap in a fresh type without it,
// rewriting the column, then drop the old type. Guarded by an explicit
// check that no row actually uses 'self_email_link' — this shouldn't
// silently discard real audit-trail data.
export class AddSelfEmailLinkConsentMethod1785130000000 implements MigrationInterface {
  name = 'AddSelfEmailLinkConsentMethod1785130000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."consent_method_enum" ADD VALUE 'self_email_link'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const inUse = (await queryRunner.query(
      `SELECT COUNT(*)::text AS count FROM "parental_consent_record" WHERE "method" = 'self_email_link'`,
    )) as Array<{ count: string }>;
    if (Number(inUse[0].count) > 0) {
      throw new Error(
        'Cannot revert AddSelfEmailLinkConsentMethod: parental_consent_record has rows using self_email_link. ' +
          'Reassign or delete them first if you really intend to drop this enum value.',
      );
    }
    await queryRunner.query(
      `ALTER TYPE "public"."consent_method_enum" RENAME TO "consent_method_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."consent_method_enum" AS ENUM('email_link', 'in_app_by_parent_account')`,
    );
    await queryRunner.query(
      `ALTER TABLE "parental_consent_record" ALTER COLUMN "method" TYPE "public"."consent_method_enum" USING "method"::text::"public"."consent_method_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."consent_method_enum_old"`);
  }
}
