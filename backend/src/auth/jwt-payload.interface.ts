export interface JwtPayload {
  /** playerId — the sessionToken is scoped to a single player, per the
   * Phase 1 contract (no login step, no multi-tenant claims). */
  sub: string;
  /**
   * ADR-0004 Part 3: mirrors Player.token_version at issuance time.
   * Optional because every Phase 1 token was minted before this claim
   * existed — JwtAuthGuard treats a missing claim as `0` (this column's
   * default), so the rollout of this claim doesn't silently invalidate
   * every session already in the wild. Only tokens issued after Phase 2
   * carry it explicitly.
   */
  tokenVersion?: number;
}
