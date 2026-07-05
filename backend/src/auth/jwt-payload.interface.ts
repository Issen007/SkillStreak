export interface JwtPayload {
  /** playerId — the sessionToken is scoped to a single player, per the
   * Phase 1 contract (no login step, no multi-tenant claims). */
  sub: string;
}
