import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ADR-0031 — joining a player account to a trainer account.
 *
 * Two tables and no changes to any existing one, which is deliberate:
 * this feature must not touch `player`, `staff_account`, `pt_team_link`
 * or any consent table. If a future change to this design needs a column
 * on one of those, it has departed from Decision 3 (the link grants
 * nothing) and should be re-argued rather than migrated.
 *
 * Both links cascade. An erased player or a deleted staff account takes
 * the link and any outstanding challenge with it, so there is nothing to
 * sweep and nothing that can outlive the identity it described.
 */
export class AddAccountLink1788500000000 implements MigrationInterface {
  name = 'AddAccountLink1788500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "account_link" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "player_id" uuid NOT NULL,
        "staff_account_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_account_link" PRIMARY KEY ("id")
      )`,
    );
    // One-to-one in both directions, enforced by the database rather than
    // by a service check: two concurrent completions must not both win.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_account_link_player" ON "account_link" ("player_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_account_link_staff" ON "account_link" ("staff_account_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "account_link" ADD CONSTRAINT "FK_account_link_player"
       FOREIGN KEY ("player_id") REFERENCES "player"("id")
       ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "account_link" ADD CONSTRAINT "FK_account_link_staff"
       FOREIGN KEY ("staff_account_id") REFERENCES "staff_account"("id")
       ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TABLE "account_link_challenge" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "token_hash" character varying(64) NOT NULL,
        "player_id" uuid NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "consumed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_account_link_challenge" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_account_link_challenge_token"
       ON "account_link_challenge" ("token_hash")`,
    );
    await queryRunner.query(
      `ALTER TABLE "account_link_challenge" ADD CONSTRAINT "FK_account_link_challenge_player"
       FOREIGN KEY ("player_id") REFERENCES "player"("id")
       ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "account_link_challenge" DROP CONSTRAINT "FK_account_link_challenge_player"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_account_link_challenge_token"`,
    );
    await queryRunner.query(`DROP TABLE "account_link_challenge"`);
    await queryRunner.query(
      `ALTER TABLE "account_link" DROP CONSTRAINT "FK_account_link_staff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "account_link" DROP CONSTRAINT "FK_account_link_player"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_account_link_staff"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_account_link_player"`);
    await queryRunner.query(`DROP TABLE "account_link"`);
  }
}
