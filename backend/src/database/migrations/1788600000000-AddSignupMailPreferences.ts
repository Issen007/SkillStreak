import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Splits "what mail does this person want" out of `interest`.
 *
 * The signup form was a single demo-event registration: everyone on the
 * list was there for the September showing, and `interest` doubled as both
 * "how do you want to be involved" and "why are we allowed to mail you".
 * The project owner's 2026-08-21 ask — people should be able to sign up
 * for upcoming releases *as well as* for being part of the journey — makes
 * those two orthogonal. Someone who wants to join as a co-owner wants
 * release news too, and a single-select field cannot say both.
 *
 * Timestamps rather than booleans, matching `privacy_accepted_at`'s
 * reasoning: consent to be mailed is a thing you may one day have to
 * evidence, and "when" is the part that answers the question.
 *
 * **The backfill is the load-bearing line.** Every existing row consented
 * to a demo invitation and nothing else — the page's consent text at the
 * time said the address would be used only to invite them. So they get
 * `demo_invite_requested_at`, and `release_updates_opted_in_at` stays NULL
 * for all of them. Nobody on the current list may be mailed release news
 * on the strength of a consent they never gave; the plan (owner's call,
 * same day) is to ask them once, under the old consent, and add only the
 * ones who answer.
 */
export class AddSignupMailPreferences1788600000000 implements MigrationInterface {
  name = 'AddSignupMailPreferences1788600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "event_registration" ADD "release_updates_opted_in_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "event_registration" ADD "demo_invite_requested_at" TIMESTAMP WITH TIME ZONE`,
    );
    // Existing rows: demo invite yes, release news no. See the docstring —
    // this is the whole reason the column is nullable rather than
    // NOT NULL DEFAULT false.
    await queryRunner.query(
      `UPDATE "event_registration" SET "demo_invite_requested_at" = "privacy_accepted_at"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "event_registration" DROP COLUMN "demo_invite_requested_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "event_registration" DROP COLUMN "release_updates_opted_in_at"`,
    );
  }
}
