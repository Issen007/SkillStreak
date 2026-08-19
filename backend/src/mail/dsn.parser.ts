/**
 * Parses a Delivery Status Notification (RFC 3464) into the one question
 * ADR-0030 Decision 5 needs answered: **did this address permanently
 * fail, and which consent was it for?**
 *
 * ## Why this is hand-written rather than a library
 *
 * This is the input path for a control that can disable a child-safety
 * feature. A wrong "permanent failure" silently revokes a consent a
 * parent granted; a missed one leaves a child's clips publishable behind
 * a dead address, which is the exact hole finding 4 named. Both
 * directions are worth being able to read end to end in review, and the
 * subset of MIME a DSN actually uses is small and rigidly specified —
 * `message/delivery-status` is plain 7-bit `Field: value` lines by
 * definition (RFC 3464 §2.1). A general MIME parser would bring a much
 * larger surface to audit for no gain on this narrow shape.
 *
 * ## What it deliberately does NOT do
 *
 * No decoding of quoted-printable or base64 bodies, no charset
 * conversion, no attachment handling. The two parts this reads —
 * `message/delivery-status` and the returned original headers — are both
 * required to be 7-bit ASCII, so decoding them would be answering a
 * question nobody asked.
 */

/** RFC 3464 §2.3.3. Only `failed` is a delivery failure. */
export type DsnAction =
  'failed' | 'delayed' | 'delivered' | 'relayed' | 'expanded';

export interface DsnRecipient {
  /** Lower-cased bare address, `rfc822;` prefix and angle brackets removed. */
  address: string;
  action: DsnAction | null;
  /** RFC 3463 status, e.g. `5.1.1`. Null when the DSN omitted it. */
  status: string | null;
  /**
   * A permanent (class 5) failure — the only thing that may count toward
   * Decision 5's disable.
   *
   * **A `4.x.x` delayed notice must never reach this.** Those are the
   * "your message has been queued for 4 hours" notices a busy or
   * temporarily-down mail server emits, and the entity's own comment on
   * `reminder_failure_count` is explicit that a parent whose mail server
   * had one bad afternoon should not be one bad afternoon away from
   * losing the consent.
   */
  permanent: boolean;
  /** The MTA's own text, kept for the log line. Never stored. */
  diagnosticCode: string | null;
}

export interface DsnReport {
  /** False for ordinary mail that merely landed in the bounce mailbox. */
  isDsn: boolean;
  recipients: DsnRecipient[];
  /** `Message-ID` of the message that bounced, from the returned headers. */
  originalMessageId: string | null;
  /**
   * Our own correlation token, recovered from the returned copy of the
   * header we set on the way out. This is the strong link back to a
   * consent row — see `extractCorrelationToken`.
   */
  originalToken: string | null;
}

/**
 * The header we stamp on every consent mail, and look for on the way
 * back. Named with an `X-` prefix and our own vendor token so it cannot
 * collide with anything an MTA adds.
 */
export const CORRELATION_HEADER = 'x-skillstreak-consent';

/** A parsed MIME part: its own headers, plus its raw body. */
interface MimePart {
  headers: Map<string, string>;
  body: string;
}

/**
 * Splits `Header: value` lines from a body at the first blank line, and
 * unfolds continuations (RFC 5322 §2.2.3 — a line starting with space or
 * tab continues the previous header).
 *
 * Header names are lower-cased, because header names are
 * case-insensitive and every lookup here would otherwise have to guess
 * which casing the sending MTA chose.
 */
function splitHeadersAndBody(raw: string): MimePart {
  // Tolerate bare LF as well as CRLF: mailboxes and test fixtures differ,
  // and a parser that only understood CRLF would silently see one giant
  // header block and report every DSN as "not a DSN".
  const normalized = raw.replace(/\r\n/g, '\n');
  const blank = normalized.indexOf('\n\n');
  const headerBlock = blank === -1 ? normalized : normalized.slice(0, blank);
  const body = blank === -1 ? '' : normalized.slice(blank + 2);

  const headers = new Map<string, string>();
  let current: string | null = null;
  for (const line of headerBlock.split('\n')) {
    if (/^[ \t]/.test(line) && current !== null) {
      headers.set(current, `${headers.get(current) ?? ''} ${line.trim()}`);
      continue;
    }
    const match = /^([^\s:]+):[ \t]*(.*)$/.exec(line);
    if (!match) continue;
    current = match[1].toLowerCase();
    // First occurrence wins. A DSN should not carry two Content-Types,
    // and preferring the first avoids a later injected duplicate
    // overriding what the structure was actually parsed against.
    if (!headers.has(current)) headers.set(current, match[2].trim());
  }
  return { headers, body };
}

/** Reads a `;`-delimited parameter out of a Content-Type, e.g. `boundary=`. */
function contentTypeParam(contentType: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|([^;\\s]+))`, 'i');
  const m = re.exec(contentType);
  if (!m) return null;
  return (m[2] ?? m[3] ?? '').trim() || null;
}

/**
 * Splits a multipart body on its boundary.
 *
 * The boundary is matched anchored to line start, and the closing
 * `--boundary--` ends the sequence. Preamble before the first boundary
 * and epilogue after the last are discarded, per RFC 2046 §5.1.1.
 */
function splitMultipart(body: string, boundary: string): string[] {
  const lines = body.split('\n');
  const delimiter = `--${boundary}`;
  const parts: string[] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    // `trimEnd()`, not a regex. This ran `/[\r\s]+$/` over every body line
    // of every multipart, and that pattern backtracks quadratically on a
    // run of whitespace followed by a non-whitespace character: measured
    // 27ms at 10k chars, 1.8s at 80k, extrapolating to minutes on a 1MB
    // line. Since this parses unauthenticated mail sent to an address
    // every parent already has, one message could pin the API's event
    // loop — not merely this poll — for as long as the sender cared to
    // make it. `trimEnd` is native and linear. (Security review,
    // 2026-08-19, finding 3.)
    const trimmedEnd = line.trimEnd();
    if (trimmedEnd === delimiter) {
      if (current !== null) parts.push(current.join('\n'));
      current = [];
      continue;
    }
    if (trimmedEnd === `${delimiter}--`) {
      if (current !== null) parts.push(current.join('\n'));
      current = null;
      break;
    }
    if (current !== null) current.push(line);
  }
  // An unterminated multipart (truncated message) still yields what we
  // read — a DSN missing its closing boundary is malformed but its
  // delivery-status part is usually intact and still worth reading.
  if (current !== null) parts.push(current.join('\n'));
  return parts;
}

/**
 * `Final-Recipient: rfc822; user@example.com` → `user@example.com`.
 *
 * Also strips angle brackets and display names, which non-conforming
 * MTAs sometimes include, and lower-cases the result so comparison
 * against a stored address is not defeated by casing.
 */
function normalizeDsnAddress(value: string): string | null {
  let v = value.trim();
  const semi = v.indexOf(';');
  if (semi !== -1) v = v.slice(semi + 1).trim();
  const angled = /<([^>]+)>/.exec(v);
  if (angled) v = angled[1].trim();
  v = v.replace(/^"|"$/g, '').trim();
  if (!v.includes('@')) return null;
  return v.toLowerCase();
}

/**
 * Parses the per-recipient blocks of a `message/delivery-status` part.
 *
 * Structure (RFC 3464 §2.1): a per-message field block, a blank line,
 * then one field block per recipient, blank-line separated. We only care
 * about the per-recipient blocks, and we identify them by the presence
 * of a recipient field rather than by position — some MTAs omit the
 * per-message block entirely.
 */
function parseDeliveryStatus(body: string): DsnRecipient[] {
  const out: DsnRecipient[] = [];
  for (const block of body.split(/\n[ \t]*\n/)) {
    if (!block.trim()) continue;
    const { headers } = splitHeadersAndBody(`${block}\n\n`);

    // `Original-Recipient` is what we addressed; `Final-Recipient` is
    // where it ended up after aliasing. Prefer Original when present,
    // because that is the address actually stored on the consent row —
    // a forwarded address would otherwise never match.
    const rawAddress =
      headers.get('original-recipient') ?? headers.get('final-recipient');
    if (!rawAddress) continue;
    const address = normalizeDsnAddress(rawAddress);
    if (!address) continue;

    const actionRaw = headers.get('action')?.toLowerCase().trim() ?? null;
    const action: DsnAction | null =
      actionRaw === 'failed' ||
      actionRaw === 'delayed' ||
      actionRaw === 'delivered' ||
      actionRaw === 'relayed' ||
      actionRaw === 'expanded'
        ? actionRaw
        : null;

    const statusRaw = headers.get('status')?.trim() ?? null;
    const status =
      statusRaw && /^\d\.\d+\.\d+/.test(statusRaw)
        ? /^(\d\.\d+\.\d+)/.exec(statusRaw)![1]
        : null;

    // Both signals must agree before this counts as permanent.
    //
    // `action=failed` alone is not enough: some MTAs send `failed` with a
    // 4.x.x status on the final retry of a transient problem. And a 5.x.x
    // status alone is not enough either, since it appears on `delayed`
    // notices from MTAs that report the last error seen so far. Requiring
    // both is what keeps a temporarily-unreachable parent from being
    // counted as a dead address.
    const permanent =
      action === 'failed' && status !== null && status.startsWith('5.');

    out.push({
      address,
      action,
      status,
      permanent,
      diagnosticCode: headers.get('diagnostic-code')?.trim() ?? null,
    });
  }
  return out;
}

/**
 * Pulls our correlation token out of a returned copy of the original
 * message's headers.
 *
 * Two sources, in order of trust:
 *  1. the `X-SkillStreak-Consent` header we set ourselves;
 *  2. the `Message-ID`, whose local part we also mint from the token.
 *
 * The second is the fallback for MTAs that strip `X-` headers when
 * returning the original — several do — while almost all preserve
 * `Message-ID`.
 */
export function extractCorrelationToken(headers: Map<string, string>): {
  token: string | null;
  messageId: string | null;
} {
  const messageId = headers.get('message-id')?.trim() ?? null;

  const direct = headers.get(CORRELATION_HEADER)?.trim();
  if (direct && /^[A-Za-z0-9_-]{16,128}$/.test(direct)) {
    return { token: direct, messageId };
  }

  if (messageId) {
    // We mint these as `<psc.{token}@domain>` — see buildConsentMessageId.
    const m = /<?psc\.([A-Za-z0-9_-]{16,128})@/.exec(messageId);
    if (m) return { token: m[1], messageId };
  }

  return { token: null, messageId };
}

/** The Message-ID shape `extractCorrelationToken` knows how to read back. */
export function buildConsentMessageId(token: string, domain: string): string {
  return `<psc.${token}@${domain}>`;
}

/**
 * Walks a MIME tree collecting the two things a DSN carries that we need.
 *
 * Recursive because DSNs are not always flat: some MTAs wrap the report
 * in an outer `multipart/mixed` alongside a human-readable explanation,
 * and a parser that only looked one level deep would report those as
 * "not a DSN" and silently ignore every bounce from that MTA.
 */
function walk(
  part: MimePart,
  depth: number,
  found: {
    recipients: DsnRecipient[];
    token: string | null;
    messageId: string | null;
  },
): void {
  // Bounded to stop a malformed or hostile message from recursing without
  // end. Real DSNs are two levels deep; five is generous.
  if (depth > 5) return;

  // Kept in its original case for parameter extraction — MIME boundaries
  // ARE case-sensitive, so lower-casing the whole header would look for
  // `--abc123` in a body that says `--ABC123` and find no parts at all.
  // Only the type comparisons below are case-folded.
  const rawContentType = part.headers.get('content-type') ?? '';
  const contentType = rawContentType.toLowerCase();

  if (contentType.includes('message/delivery-status')) {
    found.recipients.push(...parseDeliveryStatus(part.body));
    return;
  }

  // The returned original, either headers-only (RFC 3462's
  // `text/rfc822-headers`) or the whole message.
  if (
    contentType.includes('rfc822-headers') ||
    contentType.includes('message/rfc822')
  ) {
    const inner = splitHeadersAndBody(part.body);
    const { token, messageId } = extractCorrelationToken(inner.headers);
    found.token ??= token;
    found.messageId ??= messageId;
    return;
  }

  if (contentType.startsWith('multipart/')) {
    const boundary = contentTypeParam(rawContentType, 'boundary');
    if (!boundary) return;
    for (const raw of splitMultipart(part.body, boundary)) {
      walk(splitHeadersAndBody(raw), depth + 1, found);
    }
  }
}

/**
 * Parse one raw message from the bounce mailbox.
 *
 * Returns `isDsn: false` for anything that is not a delivery report —
 * autoresponders, spam, and a human replying to a no-reply address all
 * land in this mailbox too, and none of them may be allowed to look like
 * a failed delivery.
 */
export function parseDsn(raw: string): DsnReport {
  const top = splitHeadersAndBody(raw);
  const found = {
    recipients: [] as DsnRecipient[],
    token: null as string | null,
    messageId: null as string | null,
  };
  walk(top, 0, found);

  return {
    // The presence of a parsed delivery-status part IS the test, rather
    // than trusting the top-level `report-type=delivery-status`
    // parameter: the parameter is what a forger would set, while a
    // well-formed per-recipient status block is what actually carries
    // the claim we act on.
    isDsn: found.recipients.length > 0,
    recipients: found.recipients,
    originalMessageId: found.messageId,
    originalToken: found.token,
  };
}
