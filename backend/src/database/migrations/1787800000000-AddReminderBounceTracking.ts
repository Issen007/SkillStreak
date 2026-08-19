import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * docs/adr/0030-revocable-public-sharing-consent.md finding 4 — the
 * asynchronous-bounce detection that Decision 5's fail-closed disable was
 * always written against but could not observe.
 *
 * Two columns, and the second is the one that makes the feature work at
 * all:
 *
 * - `last_reminder_token` correlates a bounce that arrives days later
 *   back to the reminder that caused it. It rides out on the message as
 *   both an `X-SkillStreak-Consent` header and the local part of the
 *   `Message-ID`, because MTAs differ in which they return with a failed
 *   original.
 *
 * - `last_reminder_bounced_at` / `last_reminder_bounced_token` record
 *   that a permanent bounce came back, and which reminder it was for.
 *   The token is the one the logic compares — a timestamp cannot tell a
 *   second real bounce from a duplicate of the first when a send and a
 *   bounce share an instant, and dropping a real one that way would leave
 *   the disable unreachable. **Without it the failure counter
 *   could never reach Decision 5's threshold of 2**: a bounce is
 *   asynchronous, so a counter reset on every send would run send → 0 →
 *   bounce → 1 → send → 0 → bounce → 1 forever, and a permanently dead
 *   parent address would keep a child's clips publishable indefinitely.
 *   Comparing it against `last_reminder_at` is what lets the sweep ask
 *   "did the PREVIOUS reminder bounce?" instead of "did this send
 *   throw?".
 *
 * Both are nullable with no backfill. Existing ACTIVE consents simply
 * have no token until their next reminder goes out, at which point they
 * join the scheme — there is nothing to reconstruct, since no bounce for
 * a pre-existing reminder could have been correlated anyway.
 */
export class AddReminderBounceTracking1787800000000 implements MigrationInterface {
  name = 'AddReminderBounceTracking1787800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "public_sharing_consent" ADD "last_reminder_token" character varying(128)`,
    );
    await queryRunner.query(
      `ALTER TABLE "public_sharing_consent" ADD "last_reminder_bounced_at" TIMESTAMP WITH TIME ZONE`,
    );
    // Which reminder that bounce was for. Deliberately NOT unique: it
    // holds a copy of a value from `last_reminder_token`, not an
    // independent identity.
    await queryRunner.query(
      `ALTER TABLE "public_sharing_consent" ADD "last_reminder_bounced_token" character varying(128)`,
    );
    // Unique, not merely indexed. One token pointing at two consents
    // would mis-attribute a bounce, and a mis-attributed bounce revokes
    // the wrong family's consent — a silent, wrong-direction failure on
    // the one table that records consent about child media. Postgres
    // permits many NULLs under a UNIQUE constraint, so rows that have
    // never been reminded are unaffected.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_public_sharing_consent_last_reminder_token" ON "public_sharing_consent" ("last_reminder_token")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."UQ_public_sharing_consent_last_reminder_token"`,
    );
    await queryRunner.query(
      `ALTER TABLE "public_sharing_consent" DROP COLUMN "last_reminder_bounced_token"`,
    );
    await queryRunner.query(
      `ALTER TABLE "public_sharing_consent" DROP COLUMN "last_reminder_bounced_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "public_sharing_consent" DROP COLUMN "last_reminder_token"`,
    );
  }
}
