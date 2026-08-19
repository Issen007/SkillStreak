import { createServer, Server } from 'net';
import { BounceMailboxService } from './bounce-mailbox.service';
import { buildConsentMessageId, CORRELATION_HEADER } from '../mail/dsn.parser';

/**
 * `drainMailbox` against a real socket.
 *
 * **This file exists because its absence shipped a deadlock.** The unit
 * spec next door reaches `processMessage` directly and says, in its own
 * docstring, that the transport is deliberately not exercised — so the
 * per-message delete, the `\Seen` failure flag, the per-run ceiling and
 * the bounded fetch all shipped with no test at all. The first version
 * of them issued `messageDelete` from inside imapflow's `fetch()`
 * generator, which deadlocks: imapflow's reader awaits the untagged
 * handler, which awaits the consumer, so no response is read while the
 * loop body runs and the queued command can never complete. One message
 * per run, nothing ever deleted, retried hourly forever — while
 * `isConfigured()` reported the mailbox healthy and silenced the
 * reminder sweep's alarm.
 *
 * A mock server is the only thing that can see that class of bug, and it
 * is about seventy lines. The assertions below are mostly about *which
 * commands reach the wire*, because that is precisely what a deadlock
 * changes and what an in-memory fake cannot model.
 */

const CAPS = 'IMAP4rev1 ID ENABLE NAMESPACE UIDPLUS CONDSTORE MOVE';

function dsnFor(token: string): string {
  return [
    'From: MAILER-DAEMON@mail.example.net',
    'Content-Type: multipart/report; report-type=delivery-status; boundary="B"',
    '',
    '--B',
    'Content-Type: message/delivery-status',
    '',
    'Reporting-MTA: dns; mail.example.net',
    '',
    'Final-Recipient: rfc822; parent@example.com',
    'Action: failed',
    'Status: 5.1.1',
    '',
    '--B',
    'Content-Type: message/rfc822-headers',
    '',
    `Message-ID: ${buildConsentMessageId(token, 'skillstreak.xyz')}`,
    `${CORRELATION_HEADER}: ${token}`,
    '',
    '--B--',
    '',
  ].join('\r\n');
}

/** A mock IMAP server that records every command line it receives. */
function startImapServer(
  uids: number[],
  bodyFor: (uid: number) => string,
  refuse: { store?: boolean; expunge?: boolean } = {},
) {
  const commands: string[] = [];
  const server: Server = createServer((sock) => {
    sock.write(`* OK [CAPABILITY ${CAPS}] mock ready\r\n`);
    sock.on('data', (buf) => {
      for (const line of buf.toString().split('\r\n').filter(Boolean)) {
        const [tag, ...rest] = line.split(' ');
        const cmd = (rest[0] ?? '').toUpperCase();
        const sub = (rest[1] ?? '').toUpperCase();
        commands.push(line);

        if (cmd === 'CAPABILITY') {
          sock.write(`* CAPABILITY ${CAPS}\r\n${tag} OK done\r\n`);
        } else if (cmd === 'ID') {
          sock.write(`* ID ("name" "mock")\r\n${tag} OK done\r\n`);
        } else if (cmd === 'NAMESPACE') {
          sock.write(`* NAMESPACE (("" "/")) NIL NIL\r\n${tag} OK done\r\n`);
        } else if (cmd === 'ENABLE' || cmd === 'LOGIN' || cmd === 'LOGOUT') {
          sock.write(`${tag} OK done\r\n`);
        } else if (cmd === 'LIST' || cmd === 'LSUB') {
          sock.write(`${tag} OK done\r\n`);
        } else if (cmd === 'SELECT') {
          sock.write(
            `* ${uids.length} EXISTS\r\n* 0 RECENT\r\n` +
              '* FLAGS (\\Seen \\Deleted)\r\n' +
              '* OK [PERMANENTFLAGS (\\Seen \\Deleted \\*)] ok\r\n' +
              '* OK [UIDVALIDITY 1] ok\r\n* OK [UIDNEXT 999] ok\r\n' +
              `${tag} OK [READ-WRITE] done\r\n`,
          );
        } else if (cmd === 'UID' && sub === 'SEARCH') {
          sock.write(`* SEARCH ${uids.join(' ')}\r\n${tag} OK done\r\n`);
        } else if (cmd === 'UID' && sub === 'FETCH') {
          const uid = Number(/UID FETCH (\d+)/i.exec(line)?.[1] ?? uids[0]);
          const body = bodyFor(uid);
          sock.write(
            `* 1 FETCH (UID ${uid} BODY[] {${body.length}}\r\n${body})\r\n` +
              `${tag} OK done\r\n`,
          );
        } else if (cmd === 'UID' && sub === 'STORE') {
          sock.write(`${tag} ${refuse.store ? 'NO refused' : 'OK done'}\r\n`);
        } else if (cmd === 'UID' && sub === 'EXPUNGE') {
          sock.write(`${tag} ${refuse.expunge ? 'NO refused' : 'OK done'}\r\n`);
        } else {
          sock.write(`${tag} OK done\r\n`);
        }
      }
    });
  });
  return { server, commands };
}

function buildService(
  port: number,
  consentService: unknown,
  errorLogService: unknown = { record: jest.fn().mockResolvedValue(undefined) },
) {
  const config: Record<string, string> = {
    BOUNCE_IMAP_HOST: '127.0.0.1',
    BOUNCE_IMAP_PORT: String(port),
    BOUNCE_IMAP_USER: 'u',
    BOUNCE_IMAP_PASSWORD: 'p',
    BOUNCE_IMAP_SECURE: 'false',
    BOUNCE_IMAP_MAILBOX: 'INBOX',
  };
  const configService = {
    get: (k: string): string | undefined => config[k],
    getOrThrow: (k: string): string => config[k],
  };
  return new BounceMailboxService(
    configService as never,
    consentService as never,
    errorLogService as never,
    { tryClaimScheduledJobRun: jest.fn().mockResolvedValue(true) } as never,
  );
}

const TOKEN = 'Ab3dEf6hIj9kLm2nOp5q';

describe('BounceMailboxService over a real IMAP socket', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await new Promise((r) => server!.close(() => r(undefined)));
    server = undefined;
  });

  async function run(
    uids: number[],
    bodyFor: (uid: number) => string,
    consentService: unknown,
  ) {
    const started = startImapServer(uids, bodyFor);
    server = started.server;
    await new Promise((r) =>
      started.server.listen(0, '127.0.0.1', () => r(undefined)),
    );
    const port = (started.server.address() as { port: number }).port;
    const service = buildService(port, consentService);
    await service.pollBounceMailbox();
    return started.commands;
  }

  it('actually deletes a processed message from the server', async () => {
    // THE REGRESSION. Deleting from inside the fetch generator deadlocks:
    // `UID FETCH` reaches the wire and nothing after it ever does.
    const consentService = {
      recordReminderUndeliverable: jest
        .fn()
        .mockResolvedValue({ matched: true, counted: true, disabled: false }),
    };

    const commands = await run([11], () => dsnFor(TOKEN), consentService);

    expect(consentService.recordReminderUndeliverable).toHaveBeenCalledWith(
      TOKEN,
    );
    expect(commands.some((c) => /UID STORE .*\\Deleted/i.test(c))).toBe(true);
    expect(commands.some((c) => /UID EXPUNGE/i.test(c))).toBe(true);
  }, 30_000);

  it('drains every message in the mailbox, not just the first', async () => {
    // The deadlock's other symptom: throughput of one message per run.
    const consentService = {
      recordReminderUndeliverable: jest
        .fn()
        .mockResolvedValue({ matched: true, counted: true, disabled: false }),
    };

    const commands = await run(
      [11, 12, 13],
      () => dsnFor(TOKEN),
      consentService,
    );

    const fetches = commands.filter((c) => /UID FETCH/i.test(c));
    const expunges = commands.filter((c) => /UID EXPUNGE/i.test(c));
    expect(fetches).toHaveLength(3);
    expect(expunges).toHaveLength(3);
  }, 30_000);

  it('flags an unprocessable message \\Seen so it is not retried forever', async () => {
    // Without the flag, `seen: false` is a no-op (imapflow uses
    // BODY.PEEK) and a poisonous message blocks the mailbox draining on
    // every poll, with real bounces queued behind it.
    const consentService = {
      recordReminderUndeliverable: jest
        .fn()
        .mockRejectedValue(new Error('database down')),
    };

    const commands = await run([11], () => dsnFor(TOKEN), consentService);

    expect(commands.some((c) => /UID STORE .*\\Seen/i.test(c))).toBe(true);
    // Left undeleted, so a human can still look at it.
    expect(commands.some((c) => /UID STORE .*\\Deleted/i.test(c))).toBe(false);
  }, 30_000);

  it('completes without hanging on the socket timeout', async () => {
    // The deadlock did not throw quickly — it blocked for imapflow's
    // 5-minute default socket timeout and then failed. A wall-clock
    // bound is the assertion that most directly contradicts it.
    const consentService = {
      recordReminderUndeliverable: jest
        .fn()
        .mockResolvedValue({ matched: true, counted: true, disabled: false }),
    };

    const started = Date.now();
    await run([11, 12], () => dsnFor(TOKEN), consentService);

    expect(Date.now() - started).toBeLessThan(5_000);
  }, 30_000);
});

describe('BounceMailboxService: limits and stuck messages', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await new Promise((r) => server!.close(() => r(undefined)));
    server = undefined;
  });

  async function run(
    uids: number[],
    consentService: unknown,
    opts: {
      refuse?: { store?: boolean; expunge?: boolean };
      errorLogService?: unknown;
    } = {},
  ) {
    const started = startImapServer(uids, () => dsnFor(TOKEN), opts.refuse);
    server = started.server;
    await new Promise((r) =>
      started.server.listen(0, '127.0.0.1', () => r(undefined)),
    );
    const port = (started.server.address() as { port: number }).port;
    const service = buildService(
      port,
      consentService,
      opts.errorLogService ?? {
        record: jest.fn().mockResolvedValue(undefined),
      },
    );
    await service.pollBounceMailbox();
    return started.commands;
  }

  const ok = () => ({
    recordReminderUndeliverable: jest
      .fn()
      .mockResolvedValue({ matched: true, counted: true, disabled: false }),
  });

  it('caps a flood at MAX_MESSAGES_PER_RUN', async () => {
    // Otherwise one flood turns an hourly job into an unbounded one.
    // Uncovered until now, so raising or removing the cap would have
    // passed CI silently.
    const uids = Array.from({ length: 205 }, (_, i) => i + 1);

    const commands = await run(uids, ok());

    expect(commands.filter((c) => /UID FETCH/i.test(c))).toHaveLength(200);
  }, 60_000);

  it('fetches a bounded slice of the message, not the whole thing', async () => {
    // The 256 KiB partial is a server-side bound, and it is what stops a
    // huge message being read into memory by anyone who knows the bounce
    // address. Asserted on the wire because it is expressed only in the
    // fetch options.
    const commands = await run([11], ok());

    const fetch = commands.find((c) => /UID FETCH/i.test(c));
    expect(fetch).toMatch(/BODY\.PEEK\[\]<0\.262144>/);
  }, 30_000);

  it('reports a message it cannot delete to the error log', async () => {
    // A mailbox that accepts SELECT but refuses EXPUNGE leaves the
    // message undeleted AND unflagged, so it is re-read every poll
    // forever — deletion being the whole mitigation for this mailbox
    // holding live revoke codes. A warn line is not enough; the error
    // log is the channel an operator watches.
    const errorLogService = {
      record: jest.fn<Promise<void>, [{ jobName: string; error: Error }]>(() =>
        Promise.resolve(),
      ),
    };

    await run([11], ok(), { refuse: { expunge: true }, errorLogService });

    expect(errorLogService.record).toHaveBeenCalledTimes(1);
    const recorded = errorLogService.record.mock.calls[0][0];
    expect(recorded.jobName).toBe('public-sharing:bounce-intake');
    expect(recorded.error.message).toMatch(/could not be deleted or flagged/);
  }, 30_000);

  it('reports a message it can neither process nor flag', async () => {
    const errorLogService = { record: jest.fn().mockResolvedValue(undefined) };
    const failing = {
      recordReminderUndeliverable: jest
        .fn()
        .mockRejectedValue(new Error('database down')),
    };

    await run([11], failing, { refuse: { store: true }, errorLogService });

    expect(errorLogService.record).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('says nothing to the error log on a clean run', async () => {
    const errorLogService = { record: jest.fn().mockResolvedValue(undefined) };

    await run([11], ok(), { errorLogService });

    expect(errorLogService.record).not.toHaveBeenCalled();
  }, 30_000);
});
