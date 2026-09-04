import { article8AgeFor, Jurisdiction } from './article8-age';

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
/**
 * @deprecated Sweden's age, kept as a named constant because the reasoning
 * above is worth preserving and because `article8-age.ts` cites it as one
 * row of a table rather than as the answer. Do not gate on this — call
 * `isSelfVerificationAge` with a jurisdiction instead. It is Sweden's
 * number, not everyone's, and using it directly is the bug this file had
 * from 2026-07-27 until 2026-09-04.
 */
export const SELF_VERIFICATION_MIN_AGE_YEARS = 13;

/**
 * May this child consent for themselves, where they are?
 *
 * Same rolling-offset reasoning as create-player.dto.ts's birth-year
 * bounds: computed from today's year, not a fixed birth-year cutoff, so
 * this needs no manual update as time passes. Only ever collects a birth
 * *year* (ADR-0002) — an August-born 13-year-old and a January-born one
 * are treated identically, a deliberate coarseness matching the rest of
 * this app's age handling, not an oversight.
 *
 * **`jurisdiction` is required, and deliberately not optional.** Making
 * it optional would let every existing call site keep compiling while
 * silently keeping Sweden's answer, which is exactly the bug being fixed
 * — the compiler should force each caller to say where it gets a
 * jurisdiction from. Callers that genuinely do not know pass `null` and
 * get the strictest age, which is a decision rather than an omission.
 */
export function isSelfVerificationAge(
  birthYear: number,
  jurisdiction: Jurisdiction | null,
): boolean {
  const age = new Date().getUTCFullYear() - birthYear;
  return age >= article8AgeFor(jurisdiction);
}
