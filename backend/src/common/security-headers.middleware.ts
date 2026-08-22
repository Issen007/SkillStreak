import type { NextFunction, Request, Response } from 'express';

/**
 * The headers every response from this API carries.
 *
 * Exported rather than written inline in `main.ts` so a test can assert
 * the real thing. An inline copy in a spec would prove only that the spec
 * sets headers.
 *
 * **`Referrer-Policy: no-referrer`** is the one that earns its place.
 * Half the pages this app serves are capability URLs with the secret in
 * the *path* — `/api/v1/public-sharing/<code>`, the erasure confirm and
 * cancel links, unsubscribe, the release opt-in. Any link a browser
 * follows away from one of those would otherwise put the whole URL in a
 * `Referer` header, handing a parent's approval code to a third party.
 * Those pages carry no outbound links today; this makes that a property
 * of the server rather than of whoever edits the templates next. OAuth is
 * unaffected — it carries its state in the redirect, not in `Referer`.
 *
 * **`X-Frame-Options: DENY`** because the staff console is served from
 * this origin, and a console that can be framed is a clickjacked console.
 * Nothing embeds any of this: there is no `<iframe>` in the repo, and the
 * app is native rather than a WebView (ADR-0032 chose native over an
 * in-app browser sheet).
 *
 * **`X-Content-Type-Options: nosniff`** because uploads are user content,
 * and MIME sniffing is how a file claiming to be a video gets treated as
 * something else.
 *
 * No CSP: this origin serves the console's own scripts and the consent
 * pages' inline styles, so a useful policy needs its own pass rather than
 * a guess bolted on here.
 */
export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}
