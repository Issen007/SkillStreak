import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * docs/adr/0038-countdown-timer-tier-and-weekly-click-cap.md — the x1
 * countdown-timer tier.
 *
 * Three changes, all additive: a `timed` evidence tier, a `training_timer`
 * table holding the server's clock, and `training_log_entry.timer_id`
 * linking a log to the timer that fixed its minutes. No existing row is
 * rewritten and no historical log is re-rated (the ADR's Consequences).
 *
 * `training_timer.player_id` cascades, so account erasure (which deletes
 * the player row) takes the player's timers with it, exactly as it does
 * their training logs. No location column of any kind: the table records
 * *that* a clock ran, never *where*.
 */
export class AddTrainingTimer1789700000000 implements MigrationInterface {
  name = 'AddTrainingTimer1789700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // TypeORM runs each migration inside one transaction. Before Postgres
    // 12 `ALTER TYPE ... ADD VALUE` could not run in one at all; this
    // project is on 18 (docker-compose.yml, k8s/postgres-deployment.yaml),
    // where it can, provided the new value is not USED before commit.
    // Nothing below inserts a `timed` row, so that holds by construction.
    // Same reasoning as 1788900000000-AddClientErrorSource.
    await queryRunner.query(
      `ALTER TYPE "training_log_evidence_tier_enum" ADD VALUE IF NOT EXISTS 'timed'`,
    );

    await queryRunner.query(
      `CREATE TABLE "training_timer" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "player_id" uuid NOT NULL,
        "activity_type" "activity_type_enum" NOT NULL,
        "planned_minutes" integer NOT NULL,
        "started_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "consumed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_training_timer" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_training_timer_planned_minutes"
          CHECK ("planned_minutes" BETWEEN 1 AND 480)
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "training_timer" ADD CONSTRAINT "FK_training_timer_player"
       FOREIGN KEY ("player_id") REFERENCES "player"("id")
       ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // ADR-0038 Decision 2: "there is at most one open timer". The service
    // already serializes start-a-timer on the player row lock and deletes
    // the old open timer first; this makes the rule hold at the database
    // too. Partial, so consumed timers (the audit trail of timed logs)
    // accumulate freely behind it.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_training_timer_one_open_per_player"
       ON "training_timer" ("player_id")
       WHERE "consumed_at" IS NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "training_log_entry" ADD COLUMN "timer_id" uuid`,
    );
    // SET NULL rather than CASCADE: only a player's erasure deletes a
    // consumed timer, and that already cascades the log itself via
    // player_id. A timer going away must never take a log with it.
    await queryRunner.query(
      `ALTER TABLE "training_log_entry"
       ADD CONSTRAINT "FK_training_log_entry_timer"
       FOREIGN KEY ("timer_id") REFERENCES "training_timer"("id")
       ON DELETE SET NULL`,
    );
    // One timer verifies one log — enforced here as well as by the
    // service's consumed_at check, same as the evidence-clip index.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_training_log_entry_one_log_per_timer"
       ON "training_log_entry" ("timer_id")
       WHERE "timer_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_training_log_entry_one_log_per_timer"`,
    );
    await queryRunner.query(
      `ALTER TABLE "training_log_entry" DROP CONSTRAINT "FK_training_log_entry_timer"`,
    );
    await queryRunner.query(
      `ALTER TABLE "training_log_entry" DROP COLUMN "timer_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_training_timer_one_open_per_player"`,
    );
    await queryRunner.query(
      `ALTER TABLE "training_timer" DROP CONSTRAINT "FK_training_timer_player"`,
    );
    await queryRunner.query(`DROP TABLE "training_timer"`);
    // The `timed` enum value is deliberately NOT removed. Postgres has no
    // DROP VALUE; undoing it means recreating the type and rewriting every
    // training_log_entry row, and any `timed` row still present would block
    // that. Rows logged as `timed` stay valid after a rollback — a spare
    // enum value costs nothing (same call as AddClientErrorSource).
  }
}
