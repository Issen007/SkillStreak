import { MigrationInterface, QueryRunner } from 'typeorm';

// Trainer-authored groups over the existing text drill library
// (ADR-0029 Mechanism 1).
//
// Three properties are deliberate and load-bearing:
//
//  1. **No player or team column, and no foreign key to either.** ADR-0029
//     Decision 2's structural win was that drills have no table, so no
//     query can join one to a child. Groups DO need rows — that is the
//     trade — but they reference a `staff_account` and a drill *slug*, and
//     nothing else. There is still no path from here to a player.
//  2. **Drills are referenced by slug, not by FK**, because the drill
//     library has no table to point at. A slug whose file is later removed
//     leaves a dangling row, which the read path drops rather than
//     failing — the alternative is a migration every time a drill is
//     renamed.
//  3. **ON DELETE CASCADE from staff_account.** A group is one adult's
//     organisation of public material; when the account goes, so does it.
//     No orphan, and nothing here needs an entry in ADR-0013's per-entity
//     erasure table, because none of it is about a child.
export class AddDrillGroups1787200000000 implements MigrationInterface {
  name = 'AddDrillGroups1787200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "drill_group" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_staff_account_id" uuid NOT NULL,
        "name" character varying(80) NOT NULL,
        "tags" text NOT NULL DEFAULT '',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_drill_group" PRIMARY KEY ("id"),
        CONSTRAINT "FK_drill_group_owner" FOREIGN KEY ("owner_staff_account_id")
          REFERENCES "staff_account"("id") ON DELETE CASCADE
      )
    `);

    // One trainer's groups are listed together and nothing else queries
    // this table, so owner + name is the only access pattern there is.
    await queryRunner.query(`
      CREATE INDEX "IDX_drill_group_owner"
        ON "drill_group" ("owner_staff_account_id", "name")
    `);

    await queryRunner.query(`
      CREATE TABLE "drill_group_drill" (
        "group_id" uuid NOT NULL,
        "drill_slug" character varying(120) NOT NULL,
        CONSTRAINT "PK_drill_group_drill" PRIMARY KEY ("group_id", "drill_slug"),
        CONSTRAINT "FK_drill_group_drill_group" FOREIGN KEY ("group_id")
          REFERENCES "drill_group"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "drill_group_drill"`);
    await queryRunner.query(`DROP TABLE "drill_group"`);
  }
}
