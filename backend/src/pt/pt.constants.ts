// docs/adr/0023-pt-role-and-staff-sso-rbac.md Decision A3 — "recommend 7
// days, matching ADR-0019's (unbuilt) ClipPublicationRequest design's reasoning ('a genuinely
// bigger single-sitting ask than a 15min/24h code')... deciding whether to
// let a specific adult see your child's training history is at least as
// weighty a read as watching a clip before approving it."
export const PT_CONSENT_REVIEW_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// docs/adr/0023-pt-role-and-staff-sso-rbac.md Decision A3's recommended
// additional guardrail: "a global cap on how many *pending* (not yet
// decided) requests one PT account may have open at once — a tunable
// config value, not fixed here." Read from PT_MAX_PENDING_CONSENT_REQUESTS
// at call time (see PtConsentService) with this as the fallback default —
// generous enough not to bother a PT with a handful of real teams/players,
// tight enough to bound a compromised account's cross-team reach.
export const DEFAULT_PT_MAX_PENDING_CONSENT_REQUESTS = 20;
