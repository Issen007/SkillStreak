import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// Fas 4 encryption-at-rest, 2026-07-28 — protects PlayerPrivateInfo's
// parent_contact/real_name (the only fields this app's threat model
// treats as genuinely sensitive PII, per docs/adr/0002-data-model.md
// addendum §1) against anyone with raw disk/backup/pg_dump access to
// Postgres, independent of whatever full-disk encryption the host may or
// may not have. Deliberately application-level (Node's built-in `crypto`,
// no new dependency) rather than Postgres' `pgcrypto` extension: pgcrypto's
// symmetric functions need the passphrase passed as a literal into every
// query, which risks it leaking into Postgres' own query/slow-query logs
// and WAL — application-level encryption keeps the key in the Node
// process's memory only, never sent to Postgres at all.
//
// AES-256-GCM (authenticated encryption, not just confidentiality — a
// tampered ciphertext fails to decrypt rather than silently returning
// garbage). Stored format: base64(iv (12 bytes) || authTag (16 bytes) ||
// ciphertext) — a single opaque string, so no column type change was
// needed (PlayerPrivateInfo's columns are unbounded varchar already).
//
// The key is a parameter, not read from process.env internally, so this
// stays a pure/testable function usable from both PlayerPrivateInfoService
// (via ConfigService) and src/scripts/seed.ts (a standalone script with no
// NestJS DI, reads process.env directly) — see both callers.

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const KEY_LENGTH_BYTES = 32; // AES-256

function loadKey(rawKey: string): Buffer {
  const key = Buffer.from(rawKey, 'base64');
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `PII_ENCRYPTION_KEY must decode (as base64) to exactly ${KEY_LENGTH_BYTES} bytes for AES-256 — got ${key.length}. Generate one with: openssl rand -base64 32`,
    );
  }
  return key;
}

export function encryptPii(plaintext: string, rawKey: string): string {
  const key = loadKey(rawKey);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptPii(encoded: string, rawKey: string): string {
  const key = loadKey(rawKey);
  const combined = Buffer.from(encoded, 'base64');
  const iv = combined.subarray(0, IV_LENGTH_BYTES);
  const authTag = combined.subarray(
    IV_LENGTH_BYTES,
    IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES,
  );
  const ciphertext = combined.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Shared by the two standalone-script callers (src/scripts/seed.ts, the
 * EncryptPlayerPrivateInfo migration) that run outside Nest's DI and so
 * read process.env directly, same convention as database/data-source.ts
 * reading process.env.DATABASE_URL. PlayerPrivateInfoService does NOT use
 * this — it goes through ConfigService.getOrThrow instead, the normal
 * in-app pattern.
 */
export function requirePiiEncryptionKeyFromEnv(): string {
  const key = process.env.PII_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      'PII_ENCRYPTION_KEY must be set in the environment to run this script.',
    );
  }
  return key;
}
