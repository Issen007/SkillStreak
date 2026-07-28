import { MigrationInterface, QueryRunner } from 'typeorm';

// security-reviewer finding on docs/adr/0012-profile-page-and-contact-
// email-change.md's first cut, addressed before shipping (same "found
// before ship, not after" posture as the session-reissue redesign's own
// daily-cap fix): confirming a contact-email change via the new-address
// code no longer applies it immediately. It now starts a 24h grace
// period (contact_change_apply_at) during which the OLD address (emailed
// a new, distinct cancel code at confirm time — contact_change_cancel_code)
// can cancel the change entirely. Without this, a momentarily-compromised
// session (stolen/unlocked device, leaked token — this app has no
// password to re-check) could permanently redirect the account's entire
// recovery channel in two quick authenticated calls, before the old
// address's original informational email could plausibly prompt anyone
// to react.
export class AddContactChangeGracePeriod1785400000000
  implements MigrationInterface
{
  name = 'AddContactChangeGracePeriod1785400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "player_private_info" ADD "contact_change_apply_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "player_private_info" ADD "contact_change_cancel_code" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "player_private_info" ADD CONSTRAINT "UQ_player_private_info_contact_change_cancel_code" UNIQUE ("contact_change_cancel_code")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "player_private_info" DROP CONSTRAINT "UQ_player_private_info_contact_change_cancel_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "player_private_info" DROP COLUMN "contact_change_cancel_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "player_private_info" DROP COLUMN "contact_change_apply_at"`,
    );
  }
}
