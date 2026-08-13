import { MigrationInterface, QueryRunner } from 'typeorm';

// Trainer-published material: tips a coach writes for anyone using the
// app, and a line about who they are so the good ones get found.
//
// This is the half of the owner's "scroll feed" request that touches no
// child data: an adult publishing their own words. The other half —
// children's clips crossing team boundaries — is a separate decision
// with a consent question in front of it and is deliberately not here.
//
// Three properties the schema itself enforces:
//
//  1. **Nothing links a post to a child.** No player_id, no team_id, no
//     clip. A post is written by a staff account and read by anyone; it
//     has no subject other than its author.
//  2. **`published` is not a state an author can set.** The status enum
//     has no transition an author controls past `pending_review` — the
//     move to `published` is an operator's action and is recorded with
//     who did it, because this is content that appears on children's
//     screens.
//  3. **ON DELETE CASCADE from staff_account.** A trainer who leaves
//     takes their posts with them, which is both the right default for
//     an author's own work and the simplest answer to "what happens to
//     their material".
export class AddTrainerPost1787500000000 implements MigrationInterface {
  name = 'AddTrainerPost1787500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "trainer_post_status_enum" AS ENUM (
        'pending_review', 'published', 'rejected'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "trainer_post" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "author_staff_account_id" uuid NOT NULL,
        "title" character varying(120) NOT NULL,
        "body" text NOT NULL,
        -- How the author wants to be known to readers. Separate from the
        -- account's display name so publishing is an explicit choice
        -- about being named, not a side effect of having signed in.
        "author_byline" character varying(80) NOT NULL,
        "locale" character varying(8) NOT NULL DEFAULT 'sv',
        "age_band" character varying(16),
        "focus" character varying(32),
        "status" "trainer_post_status_enum" NOT NULL DEFAULT 'pending_review',
        -- Who let this onto children's screens, and when. Not nullable
        -- once published, and kept afterwards: "an operator approved
        -- this" is the whole control, so it must be answerable later.
        "reviewed_by_staff_account_id" uuid,
        "reviewed_at" TIMESTAMP WITH TIME ZONE,
        "rejection_reason" character varying(300),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "published_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_trainer_post" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trainer_post_author" FOREIGN KEY ("author_staff_account_id")
          REFERENCES "staff_account"("id") ON DELETE CASCADE,
        -- SET NULL, not CASCADE: an operator leaving must not delete the
        -- posts they approved. The record that a review happened
        -- survives the reviewer.
        CONSTRAINT "FK_trainer_post_reviewer" FOREIGN KEY ("reviewed_by_staff_account_id")
          REFERENCES "staff_account"("id") ON DELETE SET NULL
      )
    `);

    // The reader's query: published, newest first.
    await queryRunner.query(`
      CREATE INDEX "IDX_trainer_post_published"
        ON "trainer_post" ("published_at" DESC)
        WHERE "status" = 'published'
    `);

    // The operator's queue.
    await queryRunner.query(`
      CREATE INDEX "IDX_trainer_post_pending"
        ON "trainer_post" ("created_at")
        WHERE "status" = 'pending_review'
    `);

    // An author's own list.
    await queryRunner.query(`
      CREATE INDEX "IDX_trainer_post_author"
        ON "trainer_post" ("author_staff_account_id", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "trainer_post"`);
    await queryRunner.query(`DROP TYPE "trainer_post_status_enum"`);
  }
}
