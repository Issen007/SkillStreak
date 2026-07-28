import {
  generateHumanCode,
  GeneratedHumanCode,
} from '../common/crypto/human-code.util';

// ADR-0004 Part 3 — a captain shows this to a teammate at practice (or, per
// the 2026-07-27 addendum, it's emailed to the target's own parent_contact),
// so it needs to be short and human-typable. Code format/entropy now lives
// in common/crypto/human-code.util.ts (extracted 2026-07-28 when
// docs/adr/0012-profile-page-and-contact-email-change.md needed the exact
// same shape for a second purpose) — this file just supplies the TTL that's
// specific to session reissue.

// 15 minutes — matches the real usage window (resolved in the same
// practice session), not consent's 7-day TTL.
export const SESSION_REISSUE_CODE_TTL_MS = 15 * 60 * 1000;

export type GeneratedSessionReissueCode = GeneratedHumanCode;

export function generateSessionReissueCode(): GeneratedSessionReissueCode {
  return generateHumanCode(SESSION_REISSUE_CODE_TTL_MS);
}
