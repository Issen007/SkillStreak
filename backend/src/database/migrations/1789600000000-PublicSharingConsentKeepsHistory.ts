import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Let `public_sharing_consent` keep a row per consent cycle instead of
 * overwriting the previous one.
 *
 * **The bug this fixes.** The original index was a FULL unique index on
 * `player_id` — "one row per player" — so `request()` had no choice but
 * to reuse the existing row, and it reset `approved_at`, `declined_at`,
 * `revoked_at` and `revoked_reason` to NULL on the way. The moment a
 * child tapped "ask again" after a parent had revoked, the record that
 * the parent ever granted, and ever withdrew, and why, was destroyed.
 * `requested_at` was not reset either, so the surviving row misdated the
 * new request to the first one ever made.
 *
 * That is the one flow where GDPR Art. 7(1) requires the controller be
 * able to *demonstrate* consent, and ADR-0030 Decision 9's monthly
 * review exists specifically to read this table and ask "has any parent
 * disabled this?" — a question one re-request made unanswerable.
 *
 * **The shape is not invented here.** `pt_player_consent` already does
 * exactly this (`1786000000000-AddPtTeamLinkAndPlayerConsent.ts`): a
 * PARTIAL unique index over the live states only, so at most one consent
 * can be pending or active per player while completed cycles accumulate
 * behind it. This brings the public-sharing table in line with its
 * sibling rather than inventing a second pattern.
 *
 * No backfill: every existing row is its player's only row, and each is
 * in exactly one state, so all of them satisfy the partial index.
 * Nothing is rewritten and nothing is lost by applying this — the
 * history that was already overwritten is gone, but no further cycle
 * will be.
 */
export class PublicSharingConsentKeepsHistory1789600000000 implements MigrationInterface {
  name = 'PublicSharingConsentKeepsHistory1789600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."UQ_public_sharing_consent_player"`,
    );
    // Live states only. 'declined', 'revoked' and 'expired' are terminal:
    // a player may accumulate any number of those, and exactly one
    // pending-or-active consent at a time.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_public_sharing_consent_player_live"
         ON "public_sharing_consent" ("player_id")
         WHERE "status" IN ('pending_review', 'active')`,
    );
    // The by-player history read ("show me this child's consent
    // cycles, newest first") now returns more than one row, so it gets
    // an index rather than a sequential scan per call.
    await queryRunner.query(
      `CREATE INDEX "IDX_public_sharing_consent_player_requested_at"
         ON "public_sharing_consent" ("player_id", "requested_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Deliberately destructive and honest about it: restoring a full
    // unique index requires there to be at most one row per player, and
    // after this migration has been live there may be several. This
    // keeps the newest per player and deletes the older cycles — i.e.
    // down() re-creates the very data loss up() exists to stop. Do not
    // run it on a database that has accumulated history unless that is
    // genuinely what you want.
    await queryRunner.query(
      `DELETE FROM "public_sharing_consent" a
         USING "public_sharing_consent" b
        WHERE a."player_id" = b."player_id"
          AND a."requested_at" < b."requested_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_public_sharing_consent_player_requested_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_public_sharing_consent_player_live"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_public_sharing_consent_player" ON "public_sharing_consent" ("player_id")`,
    );
  }
}
