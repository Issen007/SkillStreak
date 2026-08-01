import { MigrationInterface, QueryRunner } from 'typeorm';

// docs/adr/0014-multi-language-support.md Decision 1 (part a — architecture
// only, no translation content). Additive, zero-downtime: a new fixed
// 8-value Postgres enum + a NOT NULL DEFAULT 'sv' column on `player`, so
// every existing row backfills itself with no data judgment call needed —
// `sv` matches today's actual (implicit, Swedish-only) behavior.
//
// Deliberately a fixed enum of the 8 targeted languages, not a freeform
// BCP-47 tag — see the ADR's Decision 1 for the full reasoning (content is
// translated by hand, one template/screen at a time; accepting an arbitrary
// tag would let a client set a value nothing renders correctly for). Widened
// from the originally-scoped 5 (sv/en/fi/da/nb) to 8 per the project
// owner's 2026-08-01 correction/expansion (adding de/cs/fr), decided before
// any translation content exists so this ships as the real target set from
// day one rather than a second migration later. `nb` (Bokmål), not `no`;
// `de` is one single locale for Switzerland/Austria/Germany, not three —
// deliberately no region subtag anywhere in this enum, per CLAUDE.md's
// no-location-tracking constraint.
export class AddPlayerLocale1785700000000 implements MigrationInterface {
  name = 'AddPlayerLocale1785700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."player_locale_enum" AS ENUM('sv', 'en', 'fi', 'da', 'nb', 'de', 'cs', 'fr')`,
    );
    await queryRunner.query(
      `ALTER TABLE "player" ADD "locale" "public"."player_locale_enum" NOT NULL DEFAULT 'sv'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "player" DROP COLUMN "locale"`);
    await queryRunner.query(`DROP TYPE "public"."player_locale_enum"`);
  }
}
