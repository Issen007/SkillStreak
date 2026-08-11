import { MigrationInterface, QueryRunner } from 'typeorm';

// `link_click` — how often each link on the public site is clicked, per day.
//
// **A counter, not an event log.** One row per (link, day), incremented by
// an UPSERT. There is no row per click and no row per person, so there is
// nothing here to anonymise: the table cannot answer "who clicked" because
// it never had the information.
//
// Deliberately absent, and none of these may be added without an ADR: no
// session id, no cookie, no IP address, no user agent, no referrer, no
// timestamp finer than the day. Each would turn an aggregate counter into
// something capable of following an individual around a site that children
// reach, and would falsify the "no trackers" answer docs/RELEASING.md
// relies on for the child-directed store review.
//
// `link` is a Postgres enum rather than a varchar because the endpoint
// writing it is unauthenticated: a free-text column there is an unbounded
// write surface that anyone on the internet can fill with anything. The
// enum makes the vocabulary a schema fact — adding a link is a migration,
// which is the point.
export class AddLinkClick1786900000000 implements MigrationInterface {
  name = 'AddLinkClick1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "link_click_link_enum" AS ENUM (
        'demo_signup', 'try_it', 'get_app', 'trainers', 'coaches_section',
        'github', 'other'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "link_click" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "link" "link_click_link_enum" NOT NULL,
        "day" date NOT NULL,
        "clicks" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_link_click" PRIMARY KEY ("id")
      )
    `);

    // The UPSERT target. One row per link per day is the whole data model,
    // so this constraint is what enforces it rather than application code.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_link_click_link_day"
        ON "link_click" ("link", "day")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "link_click"`);
    await queryRunner.query(`DROP TYPE "link_click_link_enum"`);
  }
}
