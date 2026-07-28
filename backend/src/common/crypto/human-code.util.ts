import { randomBytes } from 'crypto';

// Extracted from session/session-reissue-code.util.ts (ADR-0004 Part 3)
// when docs/adr/0012-profile-page-and-contact-email-change.md needed the
// exact same shape for a second purpose (the contact-change confirmation
// code) — same reasoning as postgres-error.util.ts's extraction: reuse
// once a pattern repeats a second time, not before. An 8-character code
// from a 32-character alphabet that excludes visually-ambiguous
// characters (0/O, 1/I). 256 (the byte range) is exactly divisible by 32,
// so `byte % 32` introduces no modulo bias.
const HUMAN_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const HUMAN_CODE_LENGTH = 8;

export interface GeneratedHumanCode {
  code: string;
  expiresAt: Date;
}

export function generateHumanCode(ttlMs: number): GeneratedHumanCode {
  const bytes = randomBytes(HUMAN_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < HUMAN_CODE_LENGTH; i++) {
    code += HUMAN_CODE_ALPHABET[bytes[i] % HUMAN_CODE_ALPHABET.length];
  }
  return {
    code,
    expiresAt: new Date(Date.now() + ttlMs),
  };
}
