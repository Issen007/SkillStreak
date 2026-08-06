import { MigrationInterface, QueryRunner } from 'typeorm';

// docs/adr/0024-streak-savers.md Decision 4 — bounded, auto-applied grace
// days for the individual streak. Two additive, zero-downtime changes:
//
//  1. `player.banked_streak_saver_count` — the durable balance, same
//     "survive a Redis flush" reasoning ADR-0002 already applies to
//     current_streak_count/longest_streak_count. `NOT NULL DEFAULT 0`
//     backfills every existing row with no behavior change until a player
//     next earns one post-rollout.
//
//  2. `streak_saver_event` — an append-only audit trail behind that
//     counter, same pattern as ParentalConsentRecord behind consent status
//     (see StreakSaverEvent entity for the full column-by-column
//     reasoning). `player_id` is ON DELETE CASCADE (a player's own erasure
//     takes their streak-saver history with it, same precedent as every
//     other per-player append-only table). The two `training_log_entry_id`
//     FKs are ON DELETE SET NULL, not CASCADE — deleting the log that
//     happened to earn/resolve a saver shouldn't delete the audit row
//     itself (same posture as pt_team_link.invited_by_player_id).
export class AddStreakSavers1786100000000 implements MigrationInterface {
  name = 'AddStreakSavers1786100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "player" ADD "banked_streak_saver_count" integer NOT NULL DEFAULT 0`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."streak_saver_event_type_enum" AS ENUM('earned', 'spent')`,
    );
    await queryRunner.query(
      `CREATE TABLE "streak_saver_event" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "player_id" uuid NOT NULL,
        "event_type" "public"."streak_saver_event_type_enum" NOT NULL,
        "banked_balance_after" integer NOT NULL,
        "training_log_entry_id" uuid,
        "covered_date" date,
        "resolved_by_training_log_entry_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_streak_saver_event" PRIMARY KEY ("id"),
        CONSTRAINT "FK_streak_saver_event_player" FOREIGN KEY ("player_id") REFERENCES "player"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_streak_saver_event_training_log_entry" FOREIGN KEY ("training_log_entry_id") REFERENCES "training_log_entry"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_streak_saver_event_resolved_by_training_log_entry" FOREIGN KEY ("resolved_by_training_log_entry_id") REFERENCES "training_log_entry"("id") ON DELETE SET NULL
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_streak_saver_event_player" ON "streak_saver_event" ("player_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_streak_saver_event_player"`,
    );
    await queryRunner.query(`DROP TABLE "streak_saver_event"`);
    await queryRunner.query(
      `DROP TYPE "public"."streak_saver_event_type_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "player" DROP COLUMN "banked_streak_saver_count"`,
    );
  }
}
