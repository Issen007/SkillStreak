import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * A short-lived, stateless token the public site fetches before it is
 * allowed to write a counter.
 *
 * ## What this is actually for, stated honestly
 *
 * It does **not** make the counts trustworthy, and nothing can. The site
 * is public, the endpoint must accept anonymous visitors, and any
 * credential a public page holds is readable by anyone who views source.
 * Authenticating an anonymous visitor is not a thing that exists.
 *
 * What it does buy, concretely:
 *
 * - A blind `POST` from a script that never fetched a token is rejected.
 *   That removes the cheapest form of abuse — the one-liner in a shell —
 *   and the drive-by from someone who found the endpoint in devtools.
 * - Abuse now costs two requests instead of one, and the token route is
 *   itself rate limited, so per-IP throttling bounds the whole flow
 *   rather than just the write.
 * - A third-party page cannot mint one, because issuing is Origin-checked.
 *
 * A determined attacker with a script still fetches a token and replays
 * it within its window. That is accepted, and it is the same trade
 * `link-click.entity.ts` already records: this measures interest, not
 * truth.
 *
 * ## Why it is not an identifier
 *
 * The token is derived from a **time bucket only** — no visitor, no
 * session, no request data goes into it, and nothing is stored anywhere.
 * Every reader in the same five minutes gets a byte-identical token, so
 * it cannot distinguish or follow anyone. That property is load-bearing:
 * a per-visitor token would be exactly the identifier this whole design
 * refuses to collect, and would drag an ePrivacy consent banner onto a
 * site children reach.
 *
 * ## Why the secret is derived rather than configured
 *
 * A new required env var is a new way for the pod to fail to boot, and
 * this repo has been bitten by that before. The key is derived from
 * `JWT_SECRET` — which is already required and already validated — with a
 * distinct label, so this token can never be confused with, or used as, a
 * session token even if one leaked into the other's verifier.
 */
@Injectable()
export class BeaconTokenService {
  /** Five minutes. Long enough for a page to load and be read a while,
   *  short enough that a scraped token is not durable. */
  private static readonly BUCKET_MS = 5 * 60 * 1000;

  /** Accept the current bucket and the one before it, so a token minted
   *  a second before a boundary is not rejected a second after it. */
  private static readonly GRACE_BUCKETS = 1;

  constructor(private readonly configService: ConfigService) {}

  private key(): Buffer {
    const base = this.configService.getOrThrow<string>('JWT_SECRET');
    return createHmac('sha256', base).update('skillstreak.beacon.v1').digest();
  }

  private sign(bucket: number): string {
    return createHmac('sha256', this.key())
      .update(String(bucket))
      .digest('base64url');
  }

  issue(now: number = Date.now()): string {
    const bucket = Math.floor(now / BeaconTokenService.BUCKET_MS);
    return `${bucket}.${this.sign(bucket)}`;
  }

  /**
   * Constant-time comparison, and a bucket range rather than an exact
   * match. Rejects anything malformed without throwing — this runs on
   * unauthenticated input and must never be a way to produce a 500.
   */
  verify(token: unknown, now: number = Date.now()): boolean {
    if (typeof token !== 'string' || token.length > 200) return false;
    const dot = token.indexOf('.');
    if (dot <= 0) return false;

    const claimed = Number(token.slice(0, dot));
    if (!Number.isSafeInteger(claimed)) return false;

    const current = Math.floor(now / BeaconTokenService.BUCKET_MS);
    if (
      claimed > current ||
      claimed < current - BeaconTokenService.GRACE_BUCKETS
    ) {
      return false;
    }

    const provided = Buffer.from(token.slice(dot + 1), 'utf8');
    const expected = Buffer.from(this.sign(claimed), 'utf8');
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(provided, expected);
  }
}
