import { MigrationInterface, QueryRunner } from 'typeorm';

// The `event_registration` table behind the public demo-signup form and its
// admin list. See the entity docstring for the design; two things about
// this table are load-bearing rather than incidental:
//
//  1. **There is no foreign key to anything.** Not to `player`, not to
//     `team`, not to `staff_account`. This holds adults who filled in a
//     public form; the rest of the schema holds children under a
//     parental-consent regime. The absence of a join path is the
//     separation, so adding a FK here is a design change and not a
//     normalisation improvement.
//  2. `privacy_accepted_at` is NOT NULL. Consent is the lawful basis for
//     the row existing at all, so a row without it should be impossible to
//     write rather than merely discouraged.
//
// Also deliberately absent: any ip_address, user_agent, or tracking-id
// column. Attribution is the plain `campaign` string from the link the
// person followed — see docs/RELEASING.md on why this project keeps a
// clean "no trackers" answer.
export class AddEventRegistration1786700000000 implements MigrationInterface {
  name = 'AddEventRegistration1786700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "event_registration_interest_enum" AS ENUM (
        'curious', 'invest', 'contribute', 'trainer', 'other'
      )
    `);
    // Its own type, not player_locale_enum: that one describes the eight
    // languages the *app* is translated into, while the public site is
    // Swedish/English. Sharing it would tie a marketing form to the app's
    // translation roadmap.
    await queryRunner.query(`
      CREATE TYPE "event_registration_locale_enum" AS ENUM ('sv', 'en')
    `);

    await queryRunner.query(`
      CREATE TABLE "event_registration" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(120) NOT NULL,
        "email" character varying(254) NOT NULL,
        "interest" "event_registration_interest_enum" NOT NULL,
        "note" character varying(500),
        "locale" "event_registration_locale_enum" NOT NULL,
        "campaign" character varying(64),
        "privacy_accepted_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_event_registration" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_event_registration_created_at"
        ON "event_registration" ("created_at")
    `);
    // The service upserts on this — registering twice is a normal accident,
    // and the endpoint answers identically either way so the form never
    // becomes an address-existence oracle.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_event_registration_email"
        ON "event_registration" ("email")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "event_registration"`);
    await queryRunner.query(`DROP TYPE "event_registration_locale_enum"`);
    await queryRunner.query(`DROP TYPE "event_registration_interest_enum"`);
  }
}
