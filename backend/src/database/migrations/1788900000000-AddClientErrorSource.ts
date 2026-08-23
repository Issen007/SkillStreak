import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A third kind of failure `error_log_entry` can hold: one that happened on
 * a child's phone.
 *
 * Until now the table has covered the two failures the *server* can see —
 * an HTTP request it answered badly, and a scheduled job that threw. A
 * render crash in the Expo app produces neither. The app dies, the child
 * closes it, and nothing anywhere records that it happened. That is
 * survivable while the only installs are a beta the owner can ask about in
 * person; it stops being survivable the week the app is on two public
 * stores and the people it crashes for are strangers.
 *
 * **Two new columns, and the choice of which two is the whole design.**
 * `client_platform` and `client_app_version` are properties of the BUILD,
 * never of the person running it — which is what lets this stay inside
 * ADR-0022 Decision 6's defining property that the table holds nothing
 * that could resolve to an identifiable child. They are also the two
 * facts without which a client crash is close to unactionable: "only on
 * Android" and "only since build 14" are the questions a report has to be
 * able to answer.
 *
 * Deliberately NOT added, though each was considered: a device id (that is
 * a per-child identifier wearing a hardware name), a screen or route name
 * (it says what a specific child was doing), a user agent (a fingerprint),
 * and anything resembling a session. The table's guarantee is structural —
 * there is no column to put them in — and that is the property worth
 * keeping over any amount of extra diagnostic convenience.
 *
 * The enum gains a value rather than the table gaining a boolean, so the
 * console's existing Source filter keeps working as a single control and
 * an `http` row still cannot carry a platform.
 */
export class AddClientErrorSource1788900000000 implements MigrationInterface {
  name = 'AddClientErrorSource1788900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // TypeORM runs each migration inside one transaction, and before
    // Postgres 12 `ALTER TYPE ... ADD VALUE` could not run in one at all.
    // This project is on 18 (docker-compose.yml, k8s/postgres-deployment
    // .yaml), where it can — with the one rule that the new value may not
    // be USED until that transaction commits. Nothing here inserts a
    // `client` row, so that rule is satisfied by construction.
    await queryRunner.query(
      `ALTER TYPE "error_log_entry_source_enum" ADD VALUE IF NOT EXISTS 'client'`,
    );
    await queryRunner.query(
      `ALTER TABLE "error_log_entry" ADD "client_platform" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "error_log_entry" ADD "client_app_version" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "error_log_entry" DROP COLUMN "client_app_version"`,
    );
    await queryRunner.query(
      `ALTER TABLE "error_log_entry" DROP COLUMN "client_platform"`,
    );
    // The enum value is deliberately NOT removed. Postgres has no
    // DROP VALUE, so undoing it means recreating the type and rewriting
    // every row that uses it — and any `client` row still present would
    // block that. A spare enum value costs nothing; a down migration that
    // can fail on real data costs a rollback.
  }
}
