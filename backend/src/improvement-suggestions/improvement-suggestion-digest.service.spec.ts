import { ImprovementSuggestionDigestService } from './improvement-suggestion-digest.service';
import { ImprovementSuggestionStatus } from './entities/improvement-suggestion.entity';

const RECIPIENT = 'owner@skillstreak.xyz';

/** Counts the service will see: the window count first, then one call per
 * status in the order the service asks for them (open, triaged, closed). */
function buildService(
  overrides: {
    recipient?: string;
    newInWindow?: number;
    open?: number;
    triaged?: number;
    closed?: number;
    countImpl?: jest.Mock;
    redisService?: Record<string, jest.Mock>;
  } = {},
) {
  const counts = {
    newInWindow: overrides.newInWindow ?? 3,
    open: overrides.open ?? 4,
    triaged: overrides.triaged ?? 1,
    closed: overrides.closed ?? 9,
  };

  const count =
    overrides.countImpl ??
    jest.fn((options: { where: Record<string, unknown> }) => {
      const status = options.where.status as
        ImprovementSuggestionStatus | undefined;
      if (status === ImprovementSuggestionStatus.OPEN)
        return Promise.resolve(counts.open);
      if (status === ImprovementSuggestionStatus.TRIAGED)
        return Promise.resolve(counts.triaged);
      if (status === ImprovementSuggestionStatus.CLOSED)
        return Promise.resolve(counts.closed);
      return Promise.resolve(counts.newInWindow);
    });

  const improvementSuggestionRepository = { count };
  const configService = {
    get: jest
      .fn()
      .mockReturnValue(
        'recipient' in overrides ? overrides.recipient : RECIPIENT,
      ),
  };
  const mailService = { sendMail: jest.fn().mockResolvedValue(undefined) };
  const errorLogService = { record: jest.fn().mockResolvedValue(undefined) };
  const redisService = {
    tryClaimScheduledJobRun: jest.fn().mockResolvedValue(true),
    ...overrides.redisService,
  };

  const service = new ImprovementSuggestionDigestService(
    improvementSuggestionRepository as never,
    configService as never,
    mailService as never,
    redisService as never,
    errorLogService as never,
  );

  return {
    service,
    improvementSuggestionRepository,
    mailService,
    errorLogService,
    redisService,
  };
}

function sentMail(mailService: { sendMail: jest.Mock }): {
  to: string;
  subject: string;
  html: string;
  text: string;
} {
  const [[options]] = mailService.sendMail.mock.calls as [
    [{ to: string; subject: string; html: string; text: string }],
  ];
  return options;
}

describe('ImprovementSuggestionDigestService.sendWeeklyDigest', () => {
  it('mails the counts to the configured recipient', async () => {
    const { service, mailService } = buildService();

    await service.sendWeeklyDigest();

    const mail = sentMail(mailService);
    expect(mail.to).toBe(RECIPIENT);
    expect(mail.subject).toContain('3 new ideas');
    expect(mail.text).toContain('New in the last 7 days: 3');
    expect(mail.text).toContain('Open: 4');
    expect(mail.text).toContain('Triaged: 1');
    expect(mail.text).toContain('Closed: 9');
  });

  /**
   * The boundary the whole design rests on: the digest is a nudge, not a
   * copy of the queue. This asserts it structurally rather than by reading
   * the mail — `count` returns numbers, so no suggestion's text is ever in
   * this service's hands to leak.
   */
  it('never reads a suggestion’s text — it only counts', async () => {
    const { service, improvementSuggestionRepository } = buildService();

    await service.sendWeeklyDigest();

    expect(improvementSuggestionRepository.count).toHaveBeenCalled();
    expect(
      (improvementSuggestionRepository as unknown as Record<string, unknown>)
        .find,
    ).toBeUndefined();
  });

  // An empty queue plus a weekly "0, 0" is how a digest teaches its one
  // reader to filter it away.
  it('sends nothing when there is nothing new and nothing open', async () => {
    const { service, mailService } = buildService({ newInWindow: 0, open: 0 });

    await service.sendWeeklyDigest();

    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  // ...but a backlog with no arrivals is the queue asking to be looked at,
  // which is exactly what this mail is for.
  it('still sends when nothing arrived but the backlog is not empty', async () => {
    const { service, mailService } = buildService({ newInWindow: 0, open: 2 });

    await service.sendWeeklyDigest();

    expect(mailService.sendMail).toHaveBeenCalledTimes(1);
    expect(sentMail(mailService).subject).toContain('2 still open');
  });

  it.each([undefined, '', 'CHANGE_ME', 'a@x.com, b@y.com'])(
    'no-ops rather than sending when the recipient is %j',
    async (recipient) => {
      const { service, mailService } = buildService({ recipient });

      await expect(service.sendWeeklyDigest()).resolves.toBeUndefined();
      expect(mailService.sendMail).not.toHaveBeenCalled();
    },
  );

  it('does nothing when another replica already claimed the run', async () => {
    const { service, mailService, improvementSuggestionRepository } =
      buildService({
        redisService: {
          tryClaimScheduledJobRun: jest.fn().mockResolvedValue(false),
        },
      });

    await service.sendWeeklyDigest();

    expect(improvementSuggestionRepository.count).not.toHaveBeenCalled();
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('records a durable failure row instead of rejecting when the send fails', async () => {
    const { service, errorLogService, mailService } = buildService();
    mailService.sendMail.mockRejectedValueOnce(new Error('smtp timeout'));

    await expect(service.sendWeeklyDigest()).resolves.toBeUndefined();
    expect(errorLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'job',
        jobName: 'improvement-suggestion:digest',
      }),
    );
  });
});
