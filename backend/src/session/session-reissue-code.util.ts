import { randomBytes } from 'crypto';

// ADR-0004 Part 3: an 8-character code from a 32-character alphabet that
// excludes visually-ambiguous characters (0/O, 1/I — digits/letters that
// are commonly confused when read aloud or glanced at quickly, the
// realistic usage pattern here: a captain shows this to a teammate at
// practice). 256 (the byte range) is exactly divisible by 32, so
// `byte % 32` introduces no modulo bias.
const REISSUE_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const REISSUE_CODE_LENGTH = 8;

// 15 minutes — matches the real usage window (resolved in the same
// practice session), not consent's 7-day TTL.
export const SESSION_REISSUE_CODE_TTL_MS = 15 * 60 * 1000;

export interface GeneratedSessionReissueCode {
  code: string;
  expiresAt: Date;
}

export function generateSessionReissueCode(): GeneratedSessionReissueCode {
  const bytes = randomBytes(REISSUE_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < REISSUE_CODE_LENGTH; i++) {
    code += REISSUE_CODE_ALPHABET[bytes[i] % REISSUE_CODE_ALPHABET.length];
  }
  return {
    code,
    expiresAt: new Date(Date.now() + SESSION_REISSUE_CODE_TTL_MS),
  };
}
