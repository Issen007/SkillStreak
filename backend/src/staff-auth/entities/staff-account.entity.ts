import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// docs/adr/0023-pt-role-and-staff-sso-rbac.md Part B, Decision B1 (as
// amended by that ADR's Status section — read it before changing this
// entity). Deliberately not named `Coach`/`AdminUser` — see the ADR's
// naming note; `Coach`/`TeamCoach` stay dormant and untouched.
export enum StaffAccountRole {
  ADMIN = 'admin',
  PT = 'pt',
}

export enum StaffAuthProvider {
  GOOGLE = 'google',
  MICROSOFT = 'microsoft',
  APPLE = 'apple',
}

@Entity('staff_account')
@Index(
  'UQ_staff_account_provider_subject',
  ['authProvider', 'authProviderSubject'],
  {
    unique: true,
  },
)
export class StaffAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // A last-known, display-only snapshot, refreshed at login for Google/
  // Microsoft (or set once at first login for Apple, same as `email`
  // below) — NEVER the sole basis for an authorization decision.
  // `AdminAuthGuard` re-derives admin authority itself on every request
  // (revoked_at + live ADMIN_EMAILS re-check); `PtAuthGuard` trusts this
  // column's mirror in the session JWT only as a cheap routing hint (a
  // `pt`-role account carries zero ambient authority by construction, see
  // Decision B1).
  @Column({
    type: 'enum',
    enum: StaffAccountRole,
    enumName: 'staff_account_role_enum',
  })
  role!: StaffAccountRole;

  @Column({
    name: 'auth_provider',
    type: 'enum',
    enum: StaffAuthProvider,
    enumName: 'staff_account_auth_provider_enum',
  })
  authProvider!: StaffAuthProvider;

  // The OIDC `sub` claim — this provider's own stable identifier for the
  // account. Combined with authProvider in the unique index above.
  @Column({ name: 'auth_provider_subject', type: 'varchar' })
  authProviderSubject!: string;

  // From the verified ID token's `email` claim. Refreshed at every login
  // for Google/Microsoft. For Apple: set ONCE at first login and never
  // refreshed again — Apple omits the `email` claim on every login after
  // the first (a hard platform behavior, not a bug to route around — see
  // Decision B1's named exception). Never user-editable in this app.
  @Column({ type: 'varchar' })
  email!: string;

  // From the ID token's `name` claim. Same refresh-cadence rule as
  // `email` (refreshed each login for Google/Microsoft, set once for
  // Apple).
  @Column({ name: 'display_name', type: 'varchar', nullable: true })
  displayName!: string | null;

  // Explicit, manual staff-account suspension lever, added per
  // security-reviewer's Part B pass (Finding 1/2 — see the ADR's Status).
  // Set directly via Postgres access (the same "operator already has
  // direct DB access" lever ADR-0020/0022 already rely on) to end a
  // specific StaffAccount's every current and future session immediately
  // — the only reliable revocation lever for an Apple-authenticated
  // account, whose persisted email may be a non-human-readable "Hide My
  // Email" relay address never meaningfully editable in ADMIN_EMAILS.
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'last_login_at', type: 'timestamptz' })
  lastLoginAt!: Date;
}
