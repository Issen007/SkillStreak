import { MigrationInterface, QueryRunner } from 'typeorm';

// Snapshots who the parent actually said yes to, onto `pt_player_consent`.
//
// From ADR-0027's security review (finding 3, applied to ADR-0023). The
// consent record snapshotted the *recipient's* contact but not the
// *trainer's* identity: every parent- and child-facing render of "who you
// approved" resolved `display_name ?? email` live from `staff_account`.
// Both of those columns are overwritten from the ID token on every
// Google/Microsoft login, and `role` is recomputed from ADMIN_EMAILS on
// every login too. So the name a parent approved could silently become a
// different name, and nothing recorded that the person was acting as a
// trainer rather than as the operator.
//
// Nullable and backfilled from the current `staff_account` values, which
// is the best available answer for consents granted before this existed —
// it is today's name, not necessarily the one shown at the time. New rows
// get the value at request time, which is the one that matters.
export class AddPtConsentIdentitySnapshot1787100000000 implements MigrationInterface {
  name = 'AddPtConsentIdentitySnapshot1787100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "pt_player_consent"
        ADD COLUMN "pt_display_name_snapshot" character varying(200),
        ADD COLUMN "pt_email_snapshot" character varying(254),
        ADD COLUMN "pt_role_at_request" character varying(16)
    `);

    // Backfill from the live row. Honest about what this is: the name the
    // account has *now*, which for anything granted before today may not
    // be the name the parent read. Better than null — a null here would be
    // indistinguishable from "we never captured it" for new rows too.
    await queryRunner.query(`
      UPDATE "pt_player_consent" c
         SET "pt_display_name_snapshot" = s."display_name",
             "pt_email_snapshot" = s."email",
             "pt_role_at_request" = s."role"::text
        FROM "staff_account" s
       WHERE s."id" = c."pt_staff_account_id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "pt_player_consent"
        DROP COLUMN "pt_role_at_request",
        DROP COLUMN "pt_email_snapshot",
        DROP COLUMN "pt_display_name_snapshot"
    `);
  }
}
