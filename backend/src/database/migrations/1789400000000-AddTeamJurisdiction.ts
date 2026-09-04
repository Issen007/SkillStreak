import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives a team the country whose GDPR Article 8 self-consent age applies
 * to its players.
 *
 * Until now the app applied Sweden's 13 to every account in every locale,
 * which was right for the Swedish beta it was written for and wrong from
 * the moment it shipped nine locales — Article 8's age is 13 to 16
 * depending on the member state, and locale cannot tell you which, since
 * `de` alone spans Germany at 16, Austria at 14 and Switzerland outside
 * the GDPR entirely.
 *
 * **Existing rows are backfilled to SE deliberately, and this is the one
 * judgement in this migration.** Every team predating this column was
 * created under an app that applied Swedish law to it, so SE preserves
 * exactly the behaviour those families already have; anything else would
 * change the consent route under live accounts. If any existing team is
 * NOT a Swedish club, that team is already being handled under the wrong
 * law today and needs its row corrected — the backfill does not create
 * that problem, it just does not fix it.
 *
 * New teams get NULL, which resolves to the strictest age (16) rather
 * than to Sweden's, so a team created before anyone states its country
 * asks for a parent instead of guessing in the permissive direction.
 */
export class AddTeamJurisdiction1789400000000 implements MigrationInterface {
  name = 'AddTeamJurisdiction1789400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "team" ADD COLUMN "jurisdiction" character varying(2)`,
    );
    await queryRunner.query(
      `UPDATE "team" SET "jurisdiction" = 'SE' WHERE "jurisdiction" IS NULL`,
    );

    // The player's own copy — see player.entity.ts for why it is
    // denormalised rather than looked up. Backfilled from the team so
    // existing accounts keep exactly the rule they onboarded under.
    await queryRunner.query(
      `ALTER TABLE "player" ADD COLUMN "jurisdiction" character varying(2)`,
    );
    await queryRunner.query(
      `UPDATE "player" p SET "jurisdiction" = t."jurisdiction" ` +
        `FROM "team" t WHERE t."id" = p."team_id"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "player" DROP COLUMN "jurisdiction"`);
    await queryRunner.query(`ALTER TABLE "team" DROP COLUMN "jurisdiction"`);
  }
}
