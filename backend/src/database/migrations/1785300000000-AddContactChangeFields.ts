import { MigrationInterface, QueryRunner } from 'typeorm';

// docs/adr/0012-profile-page-and-contact-email-change.md — the contact-
// email change flow's pending state, on PlayerPrivateInfo alongside
// real_name/parent_contact (same table, same access boundary).
// `pending_parent_contact` is encrypted the same way parent_contact is
// (ADR-0011); `contact_change_code` is deliberately NOT encrypted, same
// precedent as Player.session_reissue_code (ADR-0004 Part 3) — it needs
// to be looked up by exact-match equality, which a nondeterministic-IV
// encrypted value can't support, and its protection is single-use +
// short TTL, not encryption at rest.
export class AddContactChangeFields1785300000000 implements MigrationInterface {
  name = 'AddContactChangeFields1785300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "player_private_info" ADD "pending_parent_contact" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "player_private_info" ADD "contact_change_code" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "player_private_info" ADD "contact_change_code_expires_at" TIMESTAMP WITH TIME ZONE`,
    );
    // Plain UNIQUE constraint, not a partial index — matches
    // Player.session_reissue_code's own precedent
    // (UQ_player_session_reissue_code); Postgres already treats NULL as
    // distinct from every other NULL under a unique constraint, so no
    // WHERE clause is needed to allow multiple players with no pending
    // change at once.
    await queryRunner.query(
      `ALTER TABLE "player_private_info" ADD CONSTRAINT "UQ_player_private_info_contact_change_code" UNIQUE ("contact_change_code")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "player_private_info" DROP CONSTRAINT "UQ_player_private_info_contact_change_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "player_private_info" DROP COLUMN "contact_change_code_expires_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "player_private_info" DROP COLUMN "contact_change_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "player_private_info" DROP COLUMN "pending_parent_contact"`,
    );
  }
}
