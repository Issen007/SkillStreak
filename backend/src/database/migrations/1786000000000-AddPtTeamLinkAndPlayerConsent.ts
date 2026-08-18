import { MigrationInterface, QueryRunner } from 'typeorm';

// docs/adr/0023-pt-role-and-staff-sso-rbac.md Part A (Decisions A2/A3/A4),
// as amended by that ADR's 2026-08-03 security-reviewer pass — read the
// ADR's Status section before touching either table.
//
// Two new tables — the entire Part A schema (the not-yet-redeemed
// team-invite code itself deliberately does NOT get a table; it lives in
// Redis, short-lived and rebuildable, per the ADR's own "New tables"
// Consequences list naming only these two):
//
//  1. `pt_team_link` — the team-level link (Decision A2 "step 1"). A
//     partial unique index enforces "at most one ACTIVE link per (team,
//     PT) pair" — re-inviting after a revoke creates a new row, same
//     mechanism as idx_player_one_captain_per_team/
//     idx_account_erasure_request_one_active_per_player.
//     invited_by_player_id is ON DELETE SET NULL (Decision A2's own text +
//     the ADR's ADR-0013 interaction section) — a captain's own later
//     erasure never unwinds a PT relationship the rest of the team still
//     relies on.
//
//  2. `pt_player_consent` — the per-player consent gate (Decision A3
//     "step 2"). pt_team_link_id is ON DELETE CASCADE — this is exactly
//     what makes Decision A4's team-level cascade-revoke correct at the
//     database level too (not just application logic): deleting a
//     PtTeamLink row would take every consent rooted under it along.
//     player_id is ALSO ON DELETE CASCADE (the ADR's ADR-0013 interaction
//     section: "every PT relationship about that specific child
//     disappears with the rest of their data, automatically, no new code
//     path" when a player erases their own account).
//     pt_staff_account_id is ON DELETE CASCADE too (Decision A7: a
//     StaffAccount row can be deleted cleanly, taking every relationship
//     it held along with it).
//     A partial unique index enforces "at most one ACTIVE
//     (pending_review/approved) row per (pt_staff_account_id, player_id)",
//     identical mechanism to ADR-0019's ClipPublicationRequest design.
export class AddPtTeamLinkAndPlayerConsent1786000000000 implements MigrationInterface {
  name = 'AddPtTeamLinkAndPlayerConsent1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- pt_team_link (Decision A2) -----------------------------------------
    await queryRunner.query(
      `CREATE TYPE "public"."pt_team_link_status_enum" AS ENUM('active', 'revoked')`,
    );
    await queryRunner.query(
      `CREATE TABLE "pt_team_link" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "team_id" uuid NOT NULL,
        "pt_staff_account_id" uuid NOT NULL,
        "invited_by_player_id" uuid,
        "status" "public"."pt_team_link_status_enum" NOT NULL DEFAULT 'active',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_pt_team_link" PRIMARY KEY ("id"),
        CONSTRAINT "FK_pt_team_link_team" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_pt_team_link_staff_account" FOREIGN KEY ("pt_staff_account_id") REFERENCES "staff_account"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_pt_team_link_invited_by_player" FOREIGN KEY ("invited_by_player_id") REFERENCES "player"("id") ON DELETE SET NULL
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_pt_team_link_one_active_per_team_pt" ON "pt_team_link" ("team_id", "pt_staff_account_id") WHERE "status" = 'active'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pt_team_link_pt_staff_account" ON "pt_team_link" ("pt_staff_account_id")`,
    );

    // --- pt_player_consent (Decision A3) -------------------------------------
    await queryRunner.query(
      `CREATE TYPE "public"."pt_player_consent_status_enum" AS ENUM('pending_review', 'approved', 'declined', 'revoked', 'expired')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."pt_player_consent_revoked_reason_enum" AS ENUM('parent_or_player_revoked', 'team_link_revoked', 'account_erasure')`,
    );
    await queryRunner.query(
      `CREATE TABLE "pt_player_consent" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "pt_team_link_id" uuid NOT NULL,
        "pt_staff_account_id" uuid NOT NULL,
        "player_id" uuid NOT NULL,
        "status" "public"."pt_player_consent_status_enum" NOT NULL DEFAULT 'pending_review',
        "review_code" character varying,
        "review_code_expires_at" TIMESTAMP WITH TIME ZONE,
        "revoke_code" character varying,
        "recipient_contact_snapshot" character varying,
        "decided_at" TIMESTAMP WITH TIME ZONE,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        "revoked_reason" "public"."pt_player_consent_revoked_reason_enum",
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pt_player_consent" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_pt_player_consent_review_code" UNIQUE ("review_code"),
        CONSTRAINT "UQ_pt_player_consent_revoke_code" UNIQUE ("revoke_code"),
        CONSTRAINT "FK_pt_player_consent_team_link" FOREIGN KEY ("pt_team_link_id") REFERENCES "pt_team_link"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_pt_player_consent_staff_account" FOREIGN KEY ("pt_staff_account_id") REFERENCES "staff_account"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_pt_player_consent_player" FOREIGN KEY ("player_id") REFERENCES "player"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_pt_player_consent_one_active_per_pt_player" ON "pt_player_consent" ("pt_staff_account_id", "player_id") WHERE "status" IN ('pending_review', 'approved')`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pt_player_consent_team_link" ON "pt_player_consent" ("pt_team_link_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pt_player_consent_player" ON "pt_player_consent" ("player_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_pt_player_consent_player"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_pt_player_consent_team_link"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_pt_player_consent_one_active_per_pt_player"`,
    );
    await queryRunner.query(`DROP TABLE "pt_player_consent"`);
    await queryRunner.query(
      `DROP TYPE "public"."pt_player_consent_revoked_reason_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."pt_player_consent_status_enum"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_pt_team_link_pt_staff_account"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_pt_team_link_one_active_per_team_pt"`,
    );
    await queryRunner.query(`DROP TABLE "pt_team_link"`);
    await queryRunner.query(`DROP TYPE "public"."pt_team_link_status_enum"`);
  }
}
