import { MigrationInterface, QueryRunner } from 'typeorm';

// docs/adr/0021-clip-challenge-notifications.md Decision 2 — two additive
// columns on `team_chat_message`, team chat's first-ever exception to
// "every message is a real, authenticated player" (see that ADR's
// 2026-08-06 security-reviewer addendum before touching either column).
//
// `author_type`: `NOT NULL DEFAULT 'player'` backfills every existing row
// with no behavior change (every row in this table's history really was
// authored by a real player) — same zero-downtime backfill-via-DEFAULT
// pattern as `player.banked_streak_saver_count`
// (AddStreakSavers1786100000000).
//
// `system_event_type`: nullable, `NULL` for every `author_type = 'player'`
// row — a discriminated-union extension point (only one member today,
// `clip_challenge_issued`) in the same spirit as `BadgeAward.context`'s
// `triggerReason`.
export class AddTeamChatSystemMessages1786300000000 implements MigrationInterface {
  name = 'AddTeamChatSystemMessages1786300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."team_chat_message_author_type_enum" AS ENUM('player', 'system')`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_chat_message" ADD "author_type" "public"."team_chat_message_author_type_enum" NOT NULL DEFAULT 'player'`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."team_chat_message_system_event_type_enum" AS ENUM('clip_challenge_issued')`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_chat_message" ADD "system_event_type" "public"."team_chat_message_system_event_type_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "team_chat_message" DROP COLUMN "system_event_type"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."team_chat_message_system_event_type_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "team_chat_message" DROP COLUMN "author_type"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."team_chat_message_author_type_enum"`,
    );
  }
}
