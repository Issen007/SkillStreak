// Shared value type — imported by both PlayerModule (the `Player.
// parental_consent_status` column, which gates gameplay per ADR-0002's
// addendum §2) and PlayerPrivateInfoModule (`ParentalConsentRecord.status`,
// the append-only audit trail of the same states). Sharing the *enum* is not
// the same as sharing the *table/repository* — PlayerPrivateInfoModule still
// never imports anything from PlayerModule's persistence layer, and vice
// versa.
export enum ParentalConsentStatus {
  NOT_REQUESTED = 'not_requested',
  PENDING = 'pending',
  APPROVED = 'approved',
  REVOKED = 'revoked',
}
