import { randomBytes } from 'crypto';

// 256 bits of entropy — per the task that introduced this: brute-forcing a
// single token is not a realistic concern at this size, so no additional
// rate-limiting design is needed specifically for guessing (the
// @Throttle() on ConsentController is defense-in-depth, not the thing
// actually protecting the token).
const CONSENT_TOKEN_BYTES = 32;

// 7 days, matching the task's spec for how long a parent has to click the
// emailed link before it goes stale.
export const CONSENT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface GeneratedConsentToken {
  token: string;
  expiresAt: Date;
}

/**
 * Generates a fresh, single-use consent-approval token + its expiry.
 * Persisting it is PlayersService.setConsentToken's job (it owns the
 * Player.consent_token/consent_token_expires_at columns) — this is just the
 * value generation, shared by OnboardingService and the
 * send-test-consent-email script so both mint tokens the same way.
 */
export function generateConsentToken(): GeneratedConsentToken {
  return {
    token: randomBytes(CONSENT_TOKEN_BYTES).toString('hex'),
    expiresAt: new Date(Date.now() + CONSENT_TOKEN_TTL_MS),
  };
}
