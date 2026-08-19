import { BounceMailboxService } from './bounce-mailbox.service';
import { buildConsentMessageId, CORRELATION_HEADER } from '../mail/dsn.parser';

/**
 * ADR-0030 finding 4's intake.
 *
 * The IMAP transport itself is not exercised here — that is a network
 * conversation, and mocking ImapFlow deeply enough to be meaningful would
 * be testing the mock. What IS tested is every decision made about a
 * message once it has been read, because those decide whether a family's
 * consent survives.
 */
type EnvMap = Record<string, string>;

function build(options: { config?: EnvMap } = {}) {
  // Typed through a local rather than an `as` assertion on the default:
  // eslint's --fix strips the assertion as unnecessary, which silently
  // leaves `config` untyped and every read off it an implicit `any`.
  const config: EnvMap = options.config ?? {};
  const configService = {
    get: jest.fn((key: string): string | undefined => config[key]),
    getOrThrow: jest.fn((key: string): string => {
      const value: string | undefined = config[key];
      if (value === undefined) throw new Error(`missing ${key}`);
      return value;
    }),
  };
  const consentService = {
    recordReminderBounce: jest
      .fn()
      .mockResolvedValue({ matched: true, counted: true, disabled: false }),
  };
  const errorLogService = { record: jest.fn().mockResolvedValue(undefined) };
  const redisService = {
    tryClaimScheduledJobRun: jest.fn().mockResolvedValue(true),
  };
  const service = new BounceMailboxService(
    configService as never,
    consentService as never,
    errorLogService as never,
    redisService as never,
  );
  return { service, configService, consentService, errorLogService };
}

const CONFIGURED = {
  BOUNCE_IMAP_HOST: 'imap.example.net',
  BOUNCE_IMAP_USER: 'bounces@skillstreak.xyz',
  BOUNCE_IMAP_PASSWORD: 'secret',
};

const TOKEN = 'Ab3dEf6hIj9kLm2nOp5q';

function hardBounce(token: string | null = TOKEN): string {
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
    ...(token
      ? [
          `Message-ID: ${buildConsentMessageId(token, 'skillstreak.xyz')}`,
          `${CORRELATION_HEADER}: ${token}`,
        ]
      : ['Message-ID: <unrelated@elsewhere.test>']),
    'Subject: SkillStreak',
    '',
    '--B--',
    '',
  ].join('\r\n');
}

/** The private dispatcher, reached directly — see the file docstring. */
function process(service: BounceMailboxService, raw: string) {
  return (
    service as unknown as {
      processMessage(raw: string): Promise<{
        dsn: boolean;
        permanent: number;
        attributed: number;
        unattributed: number;
        disabled: number;
      }>;
    }
  ).processMessage(raw);
}

describe('BounceMailboxService: configuration gating', () => {
  it('is not configured when the mailbox settings are absent', () => {
    expect(build().service.isConfigured()).toBe(false);
  });

  it('is not configured when the host is set but the password is not', () => {
    // A half-configured mailbox must read as OFF, not as ON — the
    // reminder sweep keys its "unsupervised" warning off this exact
    // answer, and a partial config that reported ready would silence it.
    const { service } = build({
      config: { BOUNCE_IMAP_HOST: 'imap.example.net' },
    });
    expect(service.isConfigured()).toBe(false);
  });

  it('is configured when host, user and password are all present', () => {
    expect(build({ config: CONFIGURED }).service.isConfigured()).toBe(true);
  });

  it('does not attempt a poll while unconfigured', async () => {
    // No IMAP client is constructed, so this resolving at all is the
    // assertion: a connection attempt would throw on the missing host.
    const { service, errorLogService } = build();
    await expect(service.pollBounceMailbox()).resolves.toBeUndefined();
    expect(errorLogService.record).not.toHaveBeenCalled();
  });
});

describe('BounceMailboxService: what a message is allowed to prove', () => {
  it('attributes a permanent failure carrying our token', async () => {
    const { service, consentService } = build({ config: CONFIGURED });

    const outcome = await process(service, hardBounce());

    expect(consentService.recordReminderBounce).toHaveBeenCalledWith(TOKEN);
    expect(outcome).toMatchObject({ dsn: true, permanent: 1, attributed: 1 });
  });

  it('reports a disabled consent back in the run summary', async () => {
    const { service, consentService } = build({ config: CONFIGURED });
    consentService.recordReminderBounce.mockResolvedValue({
      matched: true,
      counted: true,
      disabled: true,
    });

    expect(await process(service, hardBounce())).toMatchObject({ disabled: 1 });
  });

  it('ignores ordinary mail that merely landed in the mailbox', async () => {
    // Autoresponders, spam, a human replying to a no-reply address.
    const { service, consentService } = build({ config: CONFIGURED });

    const outcome = await process(
      service,
      'From: a@b.test\r\nSubject: Out of office\r\n\r\nBack Monday.\r\n',
    );

    expect(outcome).toMatchObject({ dsn: false, permanent: 0 });
    expect(consentService.recordReminderBounce).not.toHaveBeenCalled();
  });

  it('does not act on a 4.x.x delayed notice', async () => {
    // The single most important negative case: counting a "still trying"
    // notice would cost a family their consent over a busy mail server.
    const { service, consentService } = build({ config: CONFIGURED });
    const raw = hardBounce()
      .replace('Action: failed', 'Action: delayed')
      .replace('Status: 5.1.1', 'Status: 4.4.1');

    const outcome = await process(service, raw);

    expect(outcome).toMatchObject({ dsn: true, permanent: 0, attributed: 0 });
    expect(consentService.recordReminderBounce).not.toHaveBeenCalled();
  });

  it('counts an untokened permanent failure as unattributed, and acts on nothing', async () => {
    // Attribution is token-only: matching on the recipient address
    // cannot say WHICH consent, since siblings share a parent address.
    // The count is what turns "how often does this happen" into a
    // measurement rather than a guess.
    const { service, consentService } = build({ config: CONFIGURED });

    const outcome = await process(service, hardBounce(null));

    expect(outcome).toMatchObject({
      dsn: true,
      permanent: 1,
      attributed: 0,
      unattributed: 1,
    });
    expect(consentService.recordReminderBounce).not.toHaveBeenCalled();
  });

  it('treats a token matching no current reminder as unattributed', async () => {
    const { service, consentService } = build({ config: CONFIGURED });
    consentService.recordReminderBounce.mockResolvedValue({ matched: false });

    const outcome = await process(service, hardBounce());

    expect(outcome).toMatchObject({ attributed: 0, unattributed: 1 });
  });
});
