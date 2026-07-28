import { randomBytes } from 'crypto';
import { decryptPii, encryptPii } from './pii-encryption.util';

const TEST_KEY = randomBytes(32).toString('base64');

describe('encryptPii / decryptPii', () => {
  it('round-trips a plaintext value', () => {
    const plaintext = 'parent@example.com';
    const encrypted = encryptPii(plaintext, TEST_KEY);
    expect(decryptPii(encrypted, TEST_KEY)).toBe(plaintext);
  });

  it('round-trips unicode content (e.g. a real name with diacritics)', () => {
    const plaintext = 'Åsa Öberg-Lindqvist';
    const encrypted = encryptPii(plaintext, TEST_KEY);
    expect(decryptPii(encrypted, TEST_KEY)).toBe(plaintext);
  });

  it('never contains the plaintext as a substring of the ciphertext', () => {
    const plaintext = 'super-secret-parent-email@example.com';
    const encrypted = encryptPii(plaintext, TEST_KEY);
    expect(encrypted).not.toContain(plaintext);
  });

  it('produces a different ciphertext each time (random IV), even for the same plaintext', () => {
    const plaintext = 'parent@example.com';
    const first = encryptPii(plaintext, TEST_KEY);
    const second = encryptPii(plaintext, TEST_KEY);
    expect(first).not.toBe(second);
    expect(decryptPii(first, TEST_KEY)).toBe(plaintext);
    expect(decryptPii(second, TEST_KEY)).toBe(plaintext);
  });

  it('fails to decrypt with the wrong key (authenticated encryption catches tampering, not just wrong keys)', () => {
    const plaintext = 'parent@example.com';
    const encrypted = encryptPii(plaintext, TEST_KEY);
    const wrongKey = randomBytes(32).toString('base64');
    expect(() => decryptPii(encrypted, wrongKey)).toThrow();
  });

  it('fails to decrypt a tampered ciphertext rather than silently returning garbage', () => {
    const plaintext = 'parent@example.com';
    const encrypted = encryptPii(plaintext, TEST_KEY);
    const buffer = Buffer.from(encrypted, 'base64');
    buffer[buffer.length - 1] ^= 0xff; // flip a bit in the ciphertext tail
    const tampered = buffer.toString('base64');
    expect(() => decryptPii(tampered, TEST_KEY)).toThrow();
  });

  it('rejects a key that does not decode to exactly 32 bytes', () => {
    const shortKey = Buffer.from('too-short').toString('base64');
    expect(() => encryptPii('anything', shortKey)).toThrow(
      /must decode.*exactly 32 bytes/,
    );
  });
});
