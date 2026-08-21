import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * When we asked an existing registrant whether they want release news.
 *
 * Its whole job is idempotency, and it is the same shape and the same
 * lesson as `invite_sent_at`: the campaign that uses it mails real people,
 * and without a record of who has already been asked, running it twice
 * asks everyone twice. On a list held together by consent, being pestered
 * is exactly what turns a registrant into a spam complaint — and a damaged
 * sending reputation takes the parental-consent email down with it.
 *
 * Null for every existing row on purpose: nobody has been asked yet.
 */
export class AddReleaseConsentAsked1788700000000 implements MigrationInterface {
  name = 'AddReleaseConsentAsked1788700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "event_registration" ADD "release_consent_asked_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "event_registration" DROP COLUMN "release_consent_asked_at"`,
    );
  }
}
