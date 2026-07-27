// Sweden's actual GDPR Article 8 digital-consent age, via Dataskyddslagen
// (2018:218) Chapter 2 §4 — the lowest age the regulation permits (13-16),
// and the age at which Swedish law lets a child consent to an information
// society service (this app) processing their own data, rather than
// requiring a parent/guardian's consent. Confirmed against current law as
// of 2026-07-27, not the separate, still-unenacted 15-year-old proposal
// specifically for logged-in social media (Kommittédirektiv 2025:91) —
// this app's own policy stays at the enacted legal minimum, chosen
// deliberately over the pending proposal or staying at "every age needs a
// parent" (see docs/adr/0002-data-model.md addendum §2's 2026-07-27
// update for the full reasoning).
export const SELF_VERIFICATION_MIN_AGE_YEARS = 13;

/**
 * Same rolling-offset reasoning as create-player.dto.ts's birth-year
 * bounds: computed from today's year, not a fixed birth-year cutoff, so
 * this needs no manual update as time passes. Only ever collects a birth
 * *year* (ADR-0002) — an August-born 13-year-old and a January-born one
 * are treated identically, a deliberate coarseness matching the rest of
 * this app's age handling, not an oversight.
 */
export function isSelfVerificationAge(birthYear: number): boolean {
  const age = new Date().getUTCFullYear() - birthYear;
  return age >= SELF_VERIFICATION_MIN_AGE_YEARS;
}
