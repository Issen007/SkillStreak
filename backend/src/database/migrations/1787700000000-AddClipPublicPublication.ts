import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ADR-0019's public clip feed, as amended by ADR-0030 — the uploader's own
 * choice of which of their clips leaves the team bubble.
 *
 * One nullable column, not a table. ADR-0019 Decision 5 requires that
 * "public-visibility state has no independent lifecycle of its own", and a
 * row with its own statuses would have one — needing reconciliation with
 * `video_clip.status` every time a clip is hidden, reported, erased or
 * swept by retention. A timestamp on the clip cannot drift from the clip.
 *
 * ADR-0019 Decision 8 originally sketched a `clip_publication_request`
 * table, because that design had a *parental* approval per clip.
 * ADR-0030's amended Decision 3 replaced that with the standing
 * account-level switch, so the request table is never built and this
 * column carries only the child's own choice.
 *
 * **The consent is deliberately NOT denormalised onto this row.** The feed
 * query joins `public_sharing_consent` instead, so revoking consent
 * removes every one of that child's clips from the feed in the same
 * instant — ADR-0030 Decision 2's un-publish guarantee enforced by the
 * query rather than by a sweep somebody has to remember to run.
 */
export class AddClipPublicPublication1787700000000 implements MigrationInterface {
  name = 'AddClipPublicPublication1787700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "video_clip" ADD "published_publicly_at" TIMESTAMP WITH TIME ZONE`,
    );

    // The feed's ORDER BY, and nothing else. Partial on the non-null case
    // because the overwhelming majority of clips are team-only and will
    // never appear here — indexing them would cost writes on every upload
    // to serve a query that can never match them.
    await queryRunner.query(
      `CREATE INDEX "IDX_video_clip_public_feed"
         ON "video_clip" ("published_publicly_at" DESC, "id" DESC)
         WHERE "published_publicly_at" IS NOT NULL`,
    );

    // A clip can only be publicly visible while it is published at all.
    // ADR-0019 Decision 5's amendment: without this a team-reported
    // (`hidden`) clip would vanish for the ~15 people who know the child
    // in person and stay visible to strangers, which is precisely
    // backwards. The feed query filters on status too — this is the
    // database refusing to hold the contradictory state in the first
    // place.
    await queryRunner.query(
      `ALTER TABLE "video_clip" ADD CONSTRAINT "CHK_video_clip_public_requires_published"
         CHECK ("published_publicly_at" IS NULL OR "status" = 'published')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "video_clip" DROP CONSTRAINT "CHK_video_clip_public_requires_published"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_video_clip_public_feed"`);
    await queryRunner.query(
      `ALTER TABLE "video_clip" DROP COLUMN "published_publicly_at"`,
    );
  }
}
