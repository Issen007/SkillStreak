import { MigrationInterface, QueryRunner } from 'typeorm';

// docs/adr/0021-clip-challenge-notifications.md Decision 1 — one nullable
// column + one partial index on `video_clip`, nothing else. Additive only;
// no change to any existing column, index, or FK.
//
// `challenge_acknowledged_at`: NULL means "still a pending challenge for
// `tagged_player_id`," set exactly once by the tagged player via
// `POST .../clips/:clipId/challenge-ack`. Only ever meaningful when
// `tagged_player_id IS NOT NULL AND status = 'published'` — see the
// VideoClip entity's own comment for the naming-collision note against the
// unrelated `Challenge` entity (ADR-0005's weekly team goal).
//
// The partial index backs exactly the "pending challenges for me" query
// (`GET .../clips/challenges/pending`) — only ever a small, bounded subset
// of rows (a player's own unacknowledged tags), same "partial index sized
// to its one real query" precedent as `IDX_team_chat_message_clip_id`.
export class AddClipChallengeAcknowledgedAt1786200000000 implements MigrationInterface {
  name = 'AddClipChallengeAcknowledgedAt1786200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "video_clip" ADD "challenge_acknowledged_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_video_clip_pending_challenge" ON "video_clip" ("tagged_player_id") WHERE "status" = 'published' AND "challenge_acknowledged_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_video_clip_pending_challenge"`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_clip" DROP COLUMN "challenge_acknowledged_at"`,
    );
  }
}
