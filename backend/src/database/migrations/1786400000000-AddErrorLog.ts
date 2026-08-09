import { MigrationInterface, QueryRunner } from 'typeorm';

// docs/adr/0022-admin-control-center.md Decision 6 — the `error_log_entry`
// table backing the admin console's error/crash + failed-job list.
//
// Read that Decision (and this table's entity docstring) before adding any
// column here: the absence of `player_id`/`team_id` is a structural
// requirement of the design, not an oversight, and the same goes for the
// absence of any column that could hold a resolved request path, body,
// query string, or header. `route` holds the Nest/Express route TEMPLATE
// only ("/api/v1/consent/:token"), because several live routes carry a
// working consent/erasure token as a path parameter.
//
// New, standalone table — no backfill concern, nothing existing to migrate.
export class AddErrorLog1786400000000 implements MigrationInterface {
  name = 'AddErrorLog1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."error_log_entry_source_enum" AS ENUM('http', 'job')`,
    );
    await queryRunner.query(
      `CREATE TABLE "error_log_entry" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "source" "public"."error_log_entry_source_enum" NOT NULL,
        "route" character varying,
        "method" character varying,
        "job_name" character varying,
        "status_code" integer,
        "error_name" character varying NOT NULL,
        "message" character varying(500) NOT NULL,
        "stack" text,
        CONSTRAINT "PK_error_log_entry" PRIMARY KEY ("id")
      )`,
    );
    // The admin list query is always "newest first", optionally narrowed by
    // source/status/date range (docs/design/phase7-admin-console-flows.md
    // §5.3), and the daily retention sweep is a single
    // `DELETE ... WHERE occurred_at < cutoff` — both served by this index.
    // Plain ASC: Postgres scans a btree backwards for ORDER BY ... DESC just
    // as cheaply, and keeping the index definition identical to the entity's
    // own @Index metadata avoids spurious `migration:generate` diffs later.
    await queryRunner.query(
      `CREATE INDEX "IDX_error_log_entry_occurred_at" ON "error_log_entry" ("occurred_at")`,
    );
    // The console's most-used filter ("show me job failures" / "show me HTTP
    // errors", still newest-first) — a composite so the source predicate and
    // the ordering come from one index rather than a filter-then-sort.
    await queryRunner.query(
      `CREATE INDEX "IDX_error_log_entry_source_occurred_at" ON "error_log_entry" ("source", "occurred_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_error_log_entry_source_occurred_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_error_log_entry_occurred_at"`,
    );
    await queryRunner.query(`DROP TABLE "error_log_entry"`);
    await queryRunner.query(`DROP TYPE "public"."error_log_entry_source_enum"`);
  }
}
