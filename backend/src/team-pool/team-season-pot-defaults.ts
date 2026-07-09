// Shared across every TeamSeasonPot-creation path (src/scripts/seed.ts,
// TeamPoolService.createInitialSeasonAndPot per
// docs/adr/0009-self-service-team-creation.md Decision 6) so
// goal_threshold's value doesn't drift into two separately hardcoded
// numbers. Per ADR-0008 Decision 4, this column is dormant/unused by any
// current response — its exact value has no product effect today, but the
// column is NOT NULL and still needs a value.
export const DEFAULT_TEAM_SEASON_POT_GOAL_THRESHOLD = 5000;
