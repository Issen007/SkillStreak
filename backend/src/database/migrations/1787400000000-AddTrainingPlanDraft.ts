import { MigrationInterface, QueryRunner } from 'typeorm';

// ADR-0028 Decision 7(b)'s shape, plus the lease columns the pull
// topology needs (owner's choice 2026-08-12: the GPU cluster has no
// inbound route, so it leases work rather than being called).
//
// The absences are the design, and they are the same ones ADR-0022
// Decision 6 made for ErrorLogEntry: **no player_id, no team_id, no FK to
// anything child-scoped.** A generated training plan is an adult's work
// product about an age band, not about a child, so this table needs no
// entry in ADR-0013's per-entity erasure table — there is nothing about a
// child in it to erase. `ON DELETE CASCADE` from staff_account handles the
// only subject it does have.
//
// The residual ADR-0028 Decision 7(c) names rather than hides: a coach
// CAN type a child's name into `prompt_text`. What stops that becoming a
// systemic leak is structural and lives in the DTO — the request the API
// sends carries promptText plus four enums and has no field capable of
// holding roster, streak or team data, and no code path enriches it.
export class AddTrainingPlanDraft1787400000000 implements MigrationInterface {
  name = 'AddTrainingPlanDraft1787400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "training_plan_status_enum" AS ENUM (
        'queued', 'generating', 'ready', 'failed'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "training_plan_draft" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "staff_account_id" uuid NOT NULL,
        "prompt_text" character varying(1000) NOT NULL,
        "age_band" character varying(16) NOT NULL,
        "duration_minutes" smallint NOT NULL,
        "focus" character varying(32),
        "locale" character varying(8) NOT NULL DEFAULT 'sv',
        "status" "training_plan_status_enum" NOT NULL DEFAULT 'queued',
        "generated_plan" text,
        "model_id" character varying(128),
        -- Which drills were in the prompt when this was generated. The
        -- corpus is version-controlled, so a plan can always be traced to
        -- the material it was built from — the same reasoning
        -- VideoClipTag.source uses for model+prompt provenance.
        "corpus_version" character varying(128),
        "attempts" smallint NOT NULL DEFAULT 0,
        "lease_id" uuid,
        "leased_until" TIMESTAMP WITH TIME ZONE,
        "failure_reason" character varying(200),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "completed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_training_plan_draft" PRIMARY KEY ("id"),
        CONSTRAINT "FK_training_plan_draft_staff_account"
          FOREIGN KEY ("staff_account_id") REFERENCES "staff_account"("id")
          ON DELETE CASCADE
      )
    `);

    // A coach's own list, newest first — the only read path there is.
    await queryRunner.query(`
      CREATE INDEX "IDX_training_plan_draft_owner"
        ON "training_plan_draft" ("staff_account_id", "created_at" DESC)
    `);

    // One live lease at a time; unique so a replayed result cannot be
    // applied twice. Same shape as the clip-tagging lease.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_training_plan_draft_lease_id"
        ON "training_plan_draft" ("lease_id") WHERE "lease_id" IS NOT NULL
    `);

    // The generator's queue query. Partial, because queued rows are a
    // small and shrinking fraction of the table.
    await queryRunner.query(`
      CREATE INDEX "IDX_training_plan_draft_queued"
        ON "training_plan_draft" ("created_at") WHERE "status" = 'queued'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "training_plan_draft"`);
    await queryRunner.query(`DROP TYPE "training_plan_status_enum"`);
  }
}
