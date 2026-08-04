import { MigrationInterface, QueryRunner } from 'typeorm';

// docs/adr/0023-pt-role-and-staff-sso-rbac.md Part B (Decision B1), as
// amended by that ADR's own 2026-08-03 security-reviewer pass — see the
// ADR's Status section before touching this table.
//
// `staff_account` is the one new entity backing both the `admin` and `pt`
// roles (Part A's own tables — `pt_team_link`/`pt_player_consent` — are a
// separate, later migration; not built by this one). Deliberately not
// named `Coach`/`AdminUser` — see Decision B1's naming note; the dormant
// `coach` table (backend/src/coaches/entities/coach.entity.ts) is
// untouched.
//
// `role` is a last-known/display value only, refreshed at login (or set
// once at first login for Apple, alongside `email`/`display_name` — see
// below) — never the sole basis for an authorization decision.
// `AdminAuthGuard` re-derives admin authority on every request instead
// (live `revoked_at`/`ADMIN_EMAILS` check), per the ADR's revised Decision
// B1/B2 text.
//
// `revoked_at` is the column the security review added (Finding 1/2): a
// manual, direct-DB-access suspension lever with no self-service UI —
// the only reliable revocation lever for an Apple-authenticated account,
// whose persisted `email` may never be freshly re-checked against
// `ADMIN_EMAILS` again after first login (Apple omits the `email`/`name`
// claims on every login after the first).
//
// No raw OAuth access/ID/refresh token is ever stored here — see Decision
// B1's explicit "never stores a raw OAuth token at rest" note.
export class AddStaffAccount1785900000000 implements MigrationInterface {
  name = 'AddStaffAccount1785900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."staff_account_role_enum" AS ENUM('admin', 'pt')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."staff_account_auth_provider_enum" AS ENUM('google', 'microsoft', 'apple')`,
    );
    await queryRunner.query(
      `CREATE TABLE "staff_account" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "role" "public"."staff_account_role_enum" NOT NULL,
        "auth_provider" "public"."staff_account_auth_provider_enum" NOT NULL,
        "auth_provider_subject" character varying NOT NULL,
        "email" character varying NOT NULL,
        "display_name" character varying,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "last_login_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_account" PRIMARY KEY ("id")
      )`,
    );
    // One row per (provider, sub) pair — the OIDC provider's own stable
    // identifier for the account, never re-derived from email (an email
    // can change hands/be reused; a `sub` cannot, per every OIDC provider's
    // own guarantee).
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_staff_account_provider_subject" ON "staff_account" ("auth_provider", "auth_provider_subject")`,
    );
    // AdminAuthGuard's per-request lookup is by id (from the session JWT's
    // `sub` claim) — already covered by the primary key. This index instead
    // supports the live re-check against ADMIN_EMAILS (Decision B1): a
    // case-insensitive lookup would otherwise be a sequential scan on a
    // table this app expects to stay very small, but the index costs
    // nothing and keeps that lookup cheap regardless of table size.
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_account_email" ON "staff_account" ("email")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_staff_account_email"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_staff_account_provider_subject"`,
    );
    await queryRunner.query(`DROP TABLE "staff_account"`);
    await queryRunner.query(
      `DROP TYPE "public"."staff_account_auth_provider_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."staff_account_role_enum"`);
  }
}
