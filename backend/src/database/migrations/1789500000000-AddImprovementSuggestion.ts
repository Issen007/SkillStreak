import { MigrationInterface, QueryRunner } from 'typeorm';

// docs/adr/0037-in-app-improvement-suggestions.md — the
// `improvement_suggestion` table behind the Tips tab's "Send us an idea"
// flow and the admin console's Ideas queue.
//
// Four things about this table are load-bearing design, not implementation
// detail — read ADR-0037 and the entity's own docstring before changing
// any of them:
//
//  1. `body` is NOT NULL. Unlike `bug_report.description`, which is
//     optional because a category and a screen carry a report on their
//     own, a suggestion with no text is nothing at all — there is no
//     picker here to fall back on.
//  2. `locale` REUSES the existing `player_locale_enum` (ADR-0014) rather
//     than creating a parallel type, so the two can never drift. That
//     means `down()` must NOT drop that type — `player.locale` and
//     `bug_report.locale` still use it.
//  3. `player_id` is ON DELETE CASCADE, mirroring `bug_report.player_id`
//     and `clip_report.reporter_player_id` per
//     docs/adr/0013-account-erasure.md ("their own filed report — their
//     own action, fine to remove with the rest of their content"). No new
//     erasure-cascade design needed.
//  4. There is no location column, no device identifier, no IP address, no
//     platform, no OS version and no action-trail column. ADR-0037's
//     capture allow-list is exactly the column list below, and it is
//     deliberately narrower than `bug_report`'s (CLAUDE.md's
//     non-negotiable constraints).
//
// New, standalone table — no backfill concern, nothing existing to migrate.
export class AddImprovementSuggestion1789500000000 implements MigrationInterface {
  name = 'AddImprovementSuggestion1789500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."improvement_suggestion_status_enum" AS ENUM('open', 'triaged', 'closed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "improvement_suggestion" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "player_id" uuid NOT NULL,
        "body" character varying(500) NOT NULL,
        "app_version" character varying NOT NULL,
        "locale" "public"."player_locale_enum" NOT NULL,
        "status" "public"."improvement_suggestion_status_enum" NOT NULL DEFAULT 'open',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_improvement_suggestion" PRIMARY KEY ("id")
      )`,
    );
    // The queue is always "newest first", optionally narrowed to a single
    // status by the filter chips — a composite so the status predicate and
    // the ordering come from one index rather than a filter-then-sort,
    // plus a plain created_at index for the unfiltered view and for the
    // weekly digest's window count. Both ASC, for the reason the header
    // comment on 1786400000000-AddErrorLog.ts already spells out.
    await queryRunner.query(
      `CREATE INDEX "IDX_improvement_suggestion_created_at" ON "improvement_suggestion" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_improvement_suggestion_status_created_at" ON "improvement_suggestion" ("status", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "improvement_suggestion" ADD CONSTRAINT "FK_improvement_suggestion_player" FOREIGN KEY ("player_id") REFERENCES "player"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improvement_suggestion" DROP CONSTRAINT "FK_improvement_suggestion_player"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_improvement_suggestion_status_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_improvement_suggestion_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "improvement_suggestion"`);
    await queryRunner.query(
      `DROP TYPE "public"."improvement_suggestion_status_enum"`,
    );
    // Deliberately NOT dropping "player_locale_enum" — this table only
    // borrows ADR-0014's existing type; `player.locale` still uses it.
  }
}
