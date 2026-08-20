import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The public site's read counter — page views and observed reading time
 * per day, per language.
 *
 * Deliberately the same shape as `link_click`: a counter keyed on
 * (locale, day), not an event log. See `site-visit.entity.ts` for why,
 * and for what that shape makes impossible to answer.
 *
 * The unique index is what the endpoint's UPSERT conflicts on, so it is
 * load-bearing rather than merely a query optimisation — without it,
 * concurrent visits would insert duplicate rows for the same day instead
 * of incrementing one.
 */
export class AddSiteVisitCounter1788100000000 implements MigrationInterface {
  name = 'AddSiteVisitCounter1788100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."site_visit_locale_enum" AS ENUM('sv', 'en')`,
    );
    await queryRunner.query(
      `CREATE TABLE "site_visit" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "locale" "public"."site_visit_locale_enum" NOT NULL,
        "day" date NOT NULL,
        "views" integer NOT NULL DEFAULT 0,
        "dwell_samples" integer NOT NULL DEFAULT 0,
        "dwell_seconds_total" bigint NOT NULL DEFAULT 0,
        CONSTRAINT "PK_site_visit" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_site_visit_locale_day" ON "site_visit" ("locale", "day")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "site_visit"`);
    await queryRunner.query(`DROP TYPE "public"."site_visit_locale_enum"`);
  }
}
