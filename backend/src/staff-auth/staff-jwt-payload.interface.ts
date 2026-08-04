import { StaffAccountRole } from './entities/staff-account.entity';

// The `staff_session` cookie's JWT payload — ADR-0023 Decision B2. No team
// or player list embedded (mirrors ADR-0004 Part 2's Coach JWT reasoning):
// a PT's actual linked players/teams are always re-derived live from Part
// A's own tables, never baked into this token.
export interface StaffJwtPayload {
  /** StaffAccount.id */
  sub: string;
  /**
   * A last-known/display hint only, refreshed at login — NEVER trusted as
   * the authorization basis by AdminAuthGuard (which does its own
   * per-request StaffAccount lookup, see that guard). PtAuthGuard *does*
   * trust this hint directly, per Decision B2's explicit reasoning: a
   * `pt`-role session carries no ambient authority to begin with.
   */
  role: StaffAccountRole;
}
