import { MigrationInterface, QueryRunner } from 'typeorm';

// docs/adr/0022-admin-control-center.md Decision 7 — the `bug_report` table
// behind the in-app "Report a problem" flow and the admin triage queue.
//
// Four things about this table are load-bearing design, not implementation
// detail — read Decision 7 and the entity's own docstring before changing
// any of them:
//
//  1. `screen` is a REAL Postgres enum, not a varchar. Decision 7's
//     2026-08-02 security-reviewer correction ("required before build")
//     fixed exactly this: the original draft described the field in prose
//     as a fixed allow-list while typing it as an unconstrained string, so
//     the schema never enforced the claim the prose made. Its 10 values are
//     docs/design/phase7-admin-console-flows.md §9.3's exact set, in picker
//     order — including `clip_upload`/`leaderboard` and the deliberate
//     omission of `roster` (folded into `team`).
//  2. `locale` REUSES the existing `player_locale_enum` (ADR-0014) rather
//     than creating a parallel type, so the two can never drift. That means
//     `down()` must NOT drop that type — `player.locale` still uses it.
//  3. `player_id` is ON DELETE CASCADE, mirroring
//     `clip_report.reporter_player_id` per docs/adr/0013-account-erasure.md
//     ("their own filed report — their own action, fine to remove with the
//     rest of their content"). No new erasure-cascade design needed.
//  4. There is no location column, no device identifier, no IP address, and
//     no action-trail column — Decision 7's capture allow-list is exactly
//     the column list below (CLAUDE.md's non-negotiable constraints).
//
// New, standalone table — no backfill concern, nothing existing to migrate.
export class AddBugReport1786500000000 implements MigrationInterface {
  name = 'AddBugReport1786500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."bug_report_category_enum" AS ENUM('crash', 'login_issue', 'missing_or_wrong_data', 'upload_failed', 'other')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."bug_report_platform_enum" AS ENUM('ios', 'android', 'web')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."bug_report_screen_enum" AS ENUM('home', 'chat', 'clips', 'clip_upload', 'goal', 'team', 'leaderboard', 'profile', 'onboarding', 'other')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."bug_report_status_enum" AS ENUM('open', 'triaged', 'closed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "bug_report" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "player_id" uuid NOT NULL,
        "category" "public"."bug_report_category_enum" NOT NULL,
        "description" character varying(500),
        "app_version" character varying NOT NULL,
        "platform" "public"."bug_report_platform_enum" NOT NULL,
        "os_version" character varying,
        "screen" "public"."bug_report_screen_enum" NOT NULL,
        "locale" "public"."player_locale_enum" NOT NULL,
        "status" "public"."bug_report_status_enum" NOT NULL DEFAULT 'open',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bug_report" PRIMARY KEY ("id")
      )`,
    );
    // The triage queue is always "newest first" (§6.1), optionally narrowed
    // to a single status by the filter chips — a composite so the status
    // predicate and the ordering come from one index rather than a
    // filter-then-sort, plus a plain created_at index for the unfiltered
    // "All" view. Both ASC, for the reason the header comment on
    // 1786400000000-AddErrorLog.ts already spells out.
    await queryRunner.query(
      `CREATE INDEX "IDX_bug_report_created_at" ON "bug_report" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bug_report_status_created_at" ON "bug_report" ("status", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_report" ADD CONSTRAINT "FK_bug_report_player" FOREIGN KEY ("player_id") REFERENCES "player"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_report" DROP CONSTRAINT "FK_bug_report_player"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bug_report_status_created_at"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_bug_report_created_at"`);
    await queryRunner.query(`DROP TABLE "bug_report"`);
    await queryRunner.query(`DROP TYPE "public"."bug_report_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."bug_report_screen_enum"`);
    await queryRunner.query(`DROP TYPE "public"."bug_report_platform_enum"`);
    await queryRunner.query(`DROP TYPE "public"."bug_report_category_enum"`);
    // Deliberately NOT dropping "player_locale_enum" — this table only
    // borrows ADR-0014's existing type; `player.locale` still uses it.
  }
}
