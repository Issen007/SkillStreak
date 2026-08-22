import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Clears `published_publicly_at` for every clip whose uploader has no
 * currently-active public-sharing consent.
 *
 * The code change beside this one makes ending a consent un-publish. It
 * only applies from now on, and the rows that already exist are exactly
 * the ones the decision was made about: a consent revoked *before* this
 * shipped left its clips flagged, so a re-approval would silently
 * republish them — the behaviour the owner asked to remove (2026-08-22).
 *
 * Nothing was visible in the meantime. The public feed re-reads consent
 * through an INNER JOIN, so those clips have been out of Utforska since
 * the moment the consent ended; this clears a flag whose only remaining
 * effect was on a future re-approval.
 *
 * **Scoped by consent, not blanket.** A player with a live consent keeps
 * their published clips exactly as they are — this must not un-share
 * anyone who is currently, legitimately sharing.
 *
 * `down()` cannot restore the timestamps: the information is the flag
 * itself, and there is no record of what it was. Deliberately a no-op
 * rather than a lie, and re-sharing is a tap per clip.
 */
export class UnpublishClipsWithoutActiveConsent1788800000000 implements MigrationInterface {
  name = 'UnpublishClipsWithoutActiveConsent1788800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "video_clip" c
          SET "published_publicly_at" = NULL
        WHERE c."published_publicly_at" IS NOT NULL
          AND NOT EXISTS (
                SELECT 1
                  FROM "public_sharing_consent" psc
                 WHERE psc."player_id" = c."uploader_player_id"
                   AND psc."status" = 'active'
              )`,
    );
    // No row-count logging: `queryRunner.query` returns `any`, and pulling
    // a count out of it costs an unsafe cast for a line nobody reads. The
    // migration is idempotent and the effect is checkable directly —
    // `SELECT count(*) FROM video_clip WHERE published_publicly_at IS NOT
    // NULL` before and after.
  }

  public async down(): Promise<void> {
    // Intentionally empty — see the class docstring.
  }
}
