import { MigrationInterface, QueryRunner } from 'typeorm';

// `pr_campaign` — the PR/marketing campaigns the project owner runs, and
// where each was posted.
//
// The join to signups is `tag`, matching `event_registration.campaign`,
// which is set from the `?campaign=` parameter on the link someone
// followed. Deliberately a plain string match rather than a foreign key:
// a campaign link can be posted before the row exists (or after it is
// deleted), and a registration must never fail because a marketing record
// is missing. The signup is the thing that matters; the attribution is
// commentary on it.
//
// Adult marketing data, exactly like `event_registration` — no player, no
// team, and no path from here to either.
export class AddPrCampaign1787000000000 implements MigrationInterface {
  name = 'AddPrCampaign1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "pr_campaign_channel_enum" AS ENUM (
        'linkedin', 'facebook', 'instagram', 'email', 'other'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "pr_campaign_audience_enum" AS ENUM (
        'general', 'investors', 'contributors', 'trainers'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "pr_campaign_status_enum" AS ENUM (
        'draft', 'scheduled', 'posted', 'archived'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "pr_campaign_locale_enum" AS ENUM ('sv', 'en')
    `);

    await queryRunner.query(`
      CREATE TABLE "pr_campaign" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(120) NOT NULL,
        "tag" character varying(64) NOT NULL,
        "channel" "pr_campaign_channel_enum" NOT NULL,
        "audience" "pr_campaign_audience_enum" NOT NULL,
        "locale" "pr_campaign_locale_enum" NOT NULL,
        "status" "pr_campaign_status_enum" NOT NULL DEFAULT 'draft',
        "body" text,
        "planned_for" date,
        "posted_at" TIMESTAMP WITH TIME ZONE,
        "posted_url" character varying(500),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pr_campaign" PRIMARY KEY ("id")
      )
    `);

    // One row per tag: the tag IS the attribution key, so two campaigns
    // sharing one would make their signup counts indistinguishable and
    // silently wrong rather than obviously broken.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_pr_campaign_tag" ON "pr_campaign" ("tag")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "pr_campaign"`);
    await queryRunner.query(`DROP TYPE "pr_campaign_locale_enum"`);
    await queryRunner.query(`DROP TYPE "pr_campaign_status_enum"`);
    await queryRunner.query(`DROP TYPE "pr_campaign_audience_enum"`);
    await queryRunner.query(`DROP TYPE "pr_campaign_channel_enum"`);
  }
}
