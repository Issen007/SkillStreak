import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renames `last_reminder_bounced_*` to `last_reminder_failure_*` on
 * `public_sharing_consent`.
 *
 * ## Why this is a second migration rather than an edit to the first
 *
 * `1787800000000-AddReminderBounceTracking` created those columns under
 * the old names, and that version was already pushed to `review` and
 * built into an internal image. The rename was first applied by editing
 * that file in place — which is wrong, and this migration exists because
 * of it.
 *
 * TypeORM keys the `migrations` table on the class name and stores no
 * checksum of the SQL. A database that has already run
 * `AddReminderBounceTracking1787800000000` will therefore **never re-run
 * it**, no matter how much its body changes. Editing it in place would
 * have left any such database holding `last_reminder_bounced_*` while the
 * entity mapped `last_reminder_failure_*` — and with `synchronize: false`
 * nothing checks, so the pod boots, `/health` stays green, and every
 * query touching this table fails at runtime. That includes the
 * parent-facing revoke page: "turn sharing off" would answer 500.
 *
 * Splitting it in two makes both starting points converge. A fresh
 * database runs 1787800 (creating the old names) then this one; a
 * database that already ran 1787800 runs only this one. Same schema
 * either way, and no guard clauses needed to express it.
 *
 * ## Why the names changed
 *
 * These columns record that a reminder was **undeliverable**, which is
 * the word ADR-0030 Decision 5 actually uses. Both kinds of evidence land
 * here — an asynchronous bounce, and a synchronous refusal at SMTP
 * handoff. Calling them `bounced` is what led to the synchronous path
 * being recorded somewhere else entirely, where the streak logic could
 * not see it (security review 2026-08-19, finding 1).
 *
 * `ALTER TABLE ... RENAME COLUMN` preserves the data, so any failure
 * already recorded keeps counting toward Decision 5's threshold.
 */
export class RenameReminderBounceToFailure1787900000000 implements MigrationInterface {
  name = 'RenameReminderBounceToFailure1787900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "public_sharing_consent" RENAME COLUMN "last_reminder_bounced_at" TO "last_reminder_failure_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "public_sharing_consent" RENAME COLUMN "last_reminder_bounced_token" TO "last_reminder_failure_token"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "public_sharing_consent" RENAME COLUMN "last_reminder_failure_token" TO "last_reminder_bounced_token"`,
    );
    await queryRunner.query(
      `ALTER TABLE "public_sharing_consent" RENAME COLUMN "last_reminder_failure_at" TO "last_reminder_bounced_at"`,
    );
  }
}
