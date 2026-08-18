import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * docs/adr/0030-revocable-public-sharing-consent.md — the standing,
 * revocable parental consent for publishing a player's own clips beyond
 * their team.
 *
 * **The ON DELETE CASCADE on `player_id` is the point of this file, not a
 * detail.** ADR-0030's security review (finding 5) found the entity
 * asserting that constraint while no migration existed to create it.
 * Without it, `AccountErasureService` — which deletes the `player` row and
 * relies on cascades for the rest — would leave an orphan row here
 * carrying an erased child's id, an ACTIVE status and a live,
 * non-expiring revoke code. That is an incomplete Article 17 erasure on
 * the one table that records a consent about child media.
 *
 * The table is created even though nothing reads it yet: the module has
 * no controller and ADR-0019's cross-team feed is unbuilt. Creating it
 * with the right constraints now is cheaper than discovering a missing
 * one later, and an empty table costs nothing.
 */
export class AddPublicSharingConsent1787600000000 implements MigrationInterface {
  name = 'AddPublicSharingConsent1787600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."public_sharing_consent_status_enum" AS ENUM('pending_review', 'active', 'declined', 'revoked', 'expired')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."public_sharing_revoked_reason_enum" AS ENUM('parent_revoked', 'reminder_undeliverable', 'account_erasure')`,
    );
    await queryRunner.query(
      `CREATE TABLE "public_sharing_consent" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "player_id" uuid NOT NULL,
        "status" "public"."public_sharing_consent_status_enum" NOT NULL DEFAULT 'pending_review',
        "review_code" character varying,
        "review_code_expires_at" TIMESTAMP WITH TIME ZONE,
        "revoke_code" character varying,
        "recipient_contact_snapshot" text,
        "requested_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "approved_at" TIMESTAMP WITH TIME ZONE,
        "declined_at" TIMESTAMP WITH TIME ZONE,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        "revoked_reason" "public"."public_sharing_revoked_reason_enum",
        "last_reminder_at" TIMESTAMP WITH TIME ZONE,
        "reminder_failure_count" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_public_sharing_consent" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_public_sharing_consent_review_code" UNIQUE ("review_code"),
        CONSTRAINT "UQ_public_sharing_consent_revoke_code" UNIQUE ("revoke_code"),
        CONSTRAINT "FK_public_sharing_consent_player" FOREIGN KEY ("player_id") REFERENCES "player"("id") ON DELETE CASCADE
      )`,
    );
    // One row per player — Decision 2 makes re-enabling a fresh grant, and
    // a table answering "is sharing on for this child" with one row cannot
    // disagree with itself.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_public_sharing_consent_player" ON "public_sharing_consent" ("player_id")`,
    );
    // The reminder sweep's query: active consents ordered by when they
    // were last reminded.
    await queryRunner.query(
      `CREATE INDEX "idx_public_sharing_consent_due_reminders" ON "public_sharing_consent" ("status", "last_reminder_at")`,
    );

    // Two invariants the service maintains and the database should not
    // rely on it to. An ACTIVE row with no revoke code is a parent who
    // cannot turn sharing off — the one failure Decision 2 says is
    // intolerable. An ACTIVE row with no last_reminder_at is invisible to
    // the sweep's `<=` comparison forever: no reminders, no failure
    // counting, permanently live. Both were flagged as latent in the
    // review's advisory finding 9.
    await queryRunner.query(
      `ALTER TABLE "public_sharing_consent" ADD CONSTRAINT "CHK_public_sharing_consent_active_is_revocable"
        CHECK ("status" <> 'active' OR ("revoke_code" IS NOT NULL AND "last_reminder_at" IS NOT NULL))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "public_sharing_consent"`);
    await queryRunner.query(
      `DROP TYPE "public"."public_sharing_revoked_reason_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."public_sharing_consent_status_enum"`,
    );
  }
}
