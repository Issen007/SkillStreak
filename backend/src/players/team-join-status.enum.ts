// `Player.team_join_status` — added 2026-07-27 for captain approval of
// new team joins (a second, independent gate alongside
// ParentalConsentStatus, not a replacement for it — see
// docs/adr/0009-self-service-team-creation.md's 2026-07-27 addendum).
export enum TeamJoinStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}
