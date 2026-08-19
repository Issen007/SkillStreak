import {
  buildConsentMessageId,
  CORRELATION_HEADER,
  parseDsn,
} from './dsn.parser';

/**
 * ADR-0030 finding 4's parser.
 *
 * The fixtures below are shaped after what real MTAs actually emit
 * (Postfix, Gmail, Exchange), because the failure this closes is
 * specifically an *asynchronous* bounce — the thing an in-process send
 * can never see — and the only place it can be gotten wrong is here.
 *
 * Two directions are tested with equal weight, and they matter for
 * opposite reasons:
 *  - a missed permanent failure leaves a child's clips publishable
 *    behind a dead parent address (the hole finding 4 named);
 *  - a false permanent failure silently revokes a consent a parent
 *    granted, on nothing more than a busy mail server.
 */

const TOKEN = 'Ab3dEf6hIj9kLm2nOp5q';

function postfixHardBounce(recipient = 'parent@example.com'): string {
  return [
    'Return-Path: <>',
    'From: MAILER-DAEMON@mail.example.net (Mail Delivery System)',
    'Subject: Undelivered Mail Returned to Sender',
    'Content-Type: multipart/report; report-type=delivery-status;',
    '\tboundary="ABC123"',
    '',
    '--ABC123',
    'Content-Type: text/plain; charset=us-ascii',
    '',
    'This is the mail system at host mail.example.net.',
    'I am sorry to have to inform you that your message could not',
    'be delivered to one or more recipients.',
    '',
    '--ABC123',
    'Content-Type: message/delivery-status',
    '',
    'Reporting-MTA: dns; mail.example.net',
    '',
    `Final-Recipient: rfc822; ${recipient}`,
    'Original-Recipient: rfc822;' + recipient,
    'Action: failed',
    'Status: 5.1.1',
    'Diagnostic-Code: smtp; 550 5.1.1 <' +
      recipient +
      '>: Recipient address rejected: User unknown',
    '',
    '--ABC123',
    'Content-Type: message/rfc822-headers',
    '',
    'Message-ID: ' + buildConsentMessageId(TOKEN, 'skillstreak.xyz'),
    `${CORRELATION_HEADER}: ${TOKEN}`,
    'From: SkillStreak <noreply@skillstreak.xyz>',
    `To: ${recipient}`,
    'Subject: SkillStreak: manadens paminnelse',
    '',
    '--ABC123--',
    '',
  ].join('\r\n');
}

describe('parseDsn: permanent failures', () => {
  it('reads a Postfix hard bounce as a permanent failure for that address', () => {
    const report = parseDsn(postfixHardBounce());

    expect(report.isDsn).toBe(true);
    expect(report.recipients).toHaveLength(1);
    expect(report.recipients[0]).toMatchObject({
      address: 'parent@example.com',
      action: 'failed',
      status: '5.1.1',
      permanent: true,
    });
  });

  it('recovers the correlation token from our own header', () => {
    expect(parseDsn(postfixHardBounce()).originalToken).toBe(TOKEN);
  });

  it('recovers the token from Message-ID when the X- header was stripped', () => {
    // Several MTAs drop X- headers when returning the original. The
    // Message-ID fallback is the whole reason the token is minted into
    // it, so this is the case that keeps those bounces attributable.
    const raw = postfixHardBounce().replace(
      new RegExp(`^${CORRELATION_HEADER}: .*$`, 'im'),
      'X-Something-Else: stripped',
    );
    const report = parseDsn(raw);
    expect(report.originalToken).toBe(TOKEN);
  });

  it('lower-cases the address so casing cannot defeat the match', () => {
    const report = parseDsn(postfixHardBounce('Parent.Name@Example.COM'));
    expect(report.recipients[0].address).toBe('parent.name@example.com');
  });

  it('strips angle brackets an MTA may add to Final-Recipient', () => {
    const raw = postfixHardBounce().replace(
      'Final-Recipient: rfc822; parent@example.com',
      'Final-Recipient: rfc822; <parent@example.com>',
    );
    expect(parseDsn(raw).recipients[0].address).toBe('parent@example.com');
  });
});

describe('parseDsn: what must NOT count as a permanent failure', () => {
  it('does not mark a 4.x.x delayed notice permanent', () => {
    // The "queued for 4 hours, still trying" notice. Counting this would
    // make one bad afternoon at a parent's mail host cost them the
    // consent — exactly what the entity comment on reminder_failure_count
    // rules out.
    const raw = postfixHardBounce()
      .replace('Action: failed', 'Action: delayed')
      .replace('Status: 5.1.1', 'Status: 4.4.1');

    const report = parseDsn(raw);
    expect(report.isDsn).toBe(true);
    expect(report.recipients[0].action).toBe('delayed');
    expect(report.recipients[0].permanent).toBe(false);
  });

  it('does not mark action=failed with a 4.x.x status permanent', () => {
    // Some MTAs report `failed` on the last retry of a transient
    // problem. The status class is the authority on permanence.
    const raw = postfixHardBounce().replace('Status: 5.1.1', 'Status: 4.4.7');
    expect(parseDsn(raw).recipients[0].permanent).toBe(false);
  });

  it('does not mark a 5.x.x status permanent when the action is delayed', () => {
    // The mirror of the case above: a delayed notice that reports the
    // worst error seen so far. Nothing has finally failed yet.
    const raw = postfixHardBounce().replace(
      'Action: failed',
      'Action: delayed',
    );
    expect(parseDsn(raw).recipients[0].permanent).toBe(false);
  });

  it('does not mark a successful delivery receipt as a failure', () => {
    const raw = postfixHardBounce()
      .replace('Action: failed', 'Action: delivered')
      .replace('Status: 5.1.1', 'Status: 2.0.0');
    expect(parseDsn(raw).recipients[0].permanent).toBe(false);
  });

  it('reports ordinary mail in the bounce mailbox as not a DSN', () => {
    // Autoresponders, spam and humans replying to a no-reply address all
    // land here. None of them may look like a failed delivery.
    const raw = [
      'From: someone@example.com',
      'To: bounces@skillstreak.xyz',
      'Subject: Out of office',
      'Content-Type: text/plain',
      '',
      'I am away until Monday.',
      '',
    ].join('\r\n');

    const report = parseDsn(raw);
    expect(report.isDsn).toBe(false);
    expect(report.recipients).toHaveLength(0);
  });

  it('reports a forged report-type with no delivery-status part as not a DSN', () => {
    // The `report-type=delivery-status` parameter is what a forger sets;
    // a well-formed per-recipient status block is what actually carries
    // the claim. Only the second is treated as evidence.
    const raw = [
      'From: attacker@example.com',
      'Content-Type: multipart/report; report-type=delivery-status; boundary="X"',
      '',
      '--X',
      'Content-Type: text/plain',
      '',
      'Final-Recipient: rfc822; parent@example.com',
      'Action: failed',
      'Status: 5.1.1',
      '',
      '--X--',
      '',
    ].join('\r\n');

    expect(parseDsn(raw).isDsn).toBe(false);
  });
});

describe('parseDsn: MTA shape variations', () => {
  it('finds a delivery-status part nested inside an outer multipart/mixed', () => {
    // Exchange and some gateways wrap the report alongside a
    // human-readable explanation. A parser that only looked one level
    // deep would silently ignore every bounce from those servers.
    const raw = [
      'Content-Type: multipart/mixed; boundary="OUTER"',
      '',
      '--OUTER',
      'Content-Type: text/plain',
      '',
      'Delivery has failed to these recipients.',
      '',
      '--OUTER',
      'Content-Type: multipart/report; report-type=delivery-status; boundary="INNER"',
      '',
      '--INNER',
      'Content-Type: message/delivery-status',
      '',
      'Reporting-MTA: dns; exchange.example.com',
      '',
      'Final-Recipient: rfc822; parent@example.com',
      'Action: failed',
      'Status: 5.4.1',
      '',
      '--INNER--',
      '',
      '--OUTER--',
      '',
    ].join('\r\n');

    const report = parseDsn(raw);
    expect(report.isDsn).toBe(true);
    expect(report.recipients[0]).toMatchObject({
      address: 'parent@example.com',
      permanent: true,
      status: '5.4.1',
    });
  });

  it('parses a message that uses bare LF instead of CRLF', () => {
    const raw = postfixHardBounce().replace(/\r\n/g, '\n');
    expect(parseDsn(raw).recipients[0].permanent).toBe(true);
  });

  it('unfolds a folded Content-Type header to find the boundary', () => {
    // The fixture already folds `boundary=` onto a continuation line;
    // assert it explicitly so a regression in unfolding is not mistaken
    // for a parsing failure elsewhere.
    expect(parseDsn(postfixHardBounce()).isDsn).toBe(true);
  });

  it('reports every failed recipient when one DSN covers several', () => {
    const raw = [
      'Content-Type: multipart/report; report-type=delivery-status; boundary="B"',
      '',
      '--B',
      'Content-Type: message/delivery-status',
      '',
      'Reporting-MTA: dns; mail.example.net',
      '',
      'Final-Recipient: rfc822; one@example.com',
      'Action: failed',
      'Status: 5.1.1',
      '',
      'Final-Recipient: rfc822; two@example.com',
      'Action: delayed',
      'Status: 4.2.2',
      '',
      '--B--',
      '',
    ].join('\r\n');

    const report = parseDsn(raw);
    expect(report.recipients).toHaveLength(2);
    expect(report.recipients[0].permanent).toBe(true);
    expect(report.recipients[1].permanent).toBe(false);
  });

  it('prefers Original-Recipient over Final-Recipient when they differ', () => {
    // Final-Recipient is where it ended up after aliasing; the consent
    // row stores the address we actually mailed, so Original is the one
    // that will match.
    const raw = [
      'Content-Type: multipart/report; report-type=delivery-status; boundary="B"',
      '',
      '--B',
      'Content-Type: message/delivery-status',
      '',
      'Reporting-MTA: dns; mail.example.net',
      '',
      'Original-Recipient: rfc822; parent@example.com',
      'Final-Recipient: rfc822; forwarded@internal.example.net',
      'Action: failed',
      'Status: 5.1.1',
      '',
      '--B--',
      '',
    ].join('\r\n');

    expect(parseDsn(raw).recipients[0].address).toBe('parent@example.com');
  });

  it('survives a truncated DSN missing its closing boundary', () => {
    const raw = postfixHardBounce().replace('\r\n--ABC123--\r\n', '\r\n');
    expect(parseDsn(raw).recipients[0].permanent).toBe(true);
  });

  it('returns no token rather than guessing when nothing identifies the original', () => {
    const raw = [
      'Content-Type: multipart/report; report-type=delivery-status; boundary="B"',
      '',
      '--B',
      'Content-Type: message/delivery-status',
      '',
      'Final-Recipient: rfc822; parent@example.com',
      'Action: failed',
      'Status: 5.1.1',
      '',
      '--B--',
      '',
    ].join('\r\n');

    const report = parseDsn(raw);
    expect(report.originalToken).toBeNull();
    expect(report.originalMessageId).toBeNull();
    expect(report.recipients[0].permanent).toBe(true);
  });

  it('ignores a correlation token that is not in our own minted shape', () => {
    // Stops an injected header from steering a bounce at an arbitrary
    // consent row.
    const raw = postfixHardBounce().replace(
      `${CORRELATION_HEADER}: ${TOKEN}`,
      `${CORRELATION_HEADER}: ../../etc/passwd`,
    );
    const report = parseDsn(raw);
    // Falls back to the Message-ID, which is still ours and still valid.
    expect(report.originalToken).toBe(TOKEN);
  });

  it('does not recurse without end on a self-referential boundary', () => {
    const raw = [
      'Content-Type: multipart/mixed; boundary="B"',
      '',
      '--B',
      'Content-Type: multipart/mixed; boundary="B2"',
      '',
      '--B2',
      'Content-Type: multipart/mixed; boundary="B3"',
      '',
      '--B3',
      'Content-Type: multipart/mixed; boundary="B4"',
      '',
      '--B4',
      'Content-Type: multipart/mixed; boundary="B5"',
      '',
      '--B5',
      'Content-Type: multipart/mixed; boundary="B6"',
      '',
      '--B6',
      'Content-Type: message/delivery-status',
      '',
      'Final-Recipient: rfc822; parent@example.com',
      'Action: failed',
      'Status: 5.1.1',
      '',
      '--B6--',
      '',
    ].join('\r\n');

    // Depth-bounded: this returns rather than hanging, and the too-deep
    // part is simply not read.
    const report = parseDsn(raw);
    expect(report.isDsn).toBe(false);
  });
});
