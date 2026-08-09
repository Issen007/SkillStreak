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
  /**
   * The IdP-asserted `auth_time` (epoch seconds) of a **verified step-up
   * re-authentication**, present only on a session issued by a step-up
   * callback — ADR-0022 Decision 10, corrected 2026-08-08 after a blocking
   * security review.
   *
   * This claim exists because the first implementation gated `planning/*`
   * on `StaffAccount.lastLoginAt`, which is wrong twice over: that column
   * is stamped by *every* completed callback (so an ordinary
   * `/login` — no `prompt=login`, no `auth_time` check, and typically zero
   * user interaction against a live IdP SSO session — satisfied the gate),
   * and it is account-scoped rather than session-scoped (so any session
   * benefited from any *other* session's login, which is exactly what
   * AdminSessionService's own comment warns against building on). The
   * carefully-verified `auth_time` proof was computed and then discarded.
   *
   * Putting it here binds the proof to the presenting session: a stolen
   * cookie cannot be upgraded by the victim signing in elsewhere, because
   * the attacker's token simply does not carry this claim.
   */
  stepUpAt?: number;
}
