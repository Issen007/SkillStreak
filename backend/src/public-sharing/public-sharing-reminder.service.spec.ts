import { PublicSharingReminderService } from './public-sharing-reminder.service';

/**
 * ADR-0030 Decision 6's sweep.
 *
 * The behaviour worth pinning here is not "does it send mail" — that is
 * the consent service's job and is tested there. It is the thing the ADR
 * spent a month refusing to let anyone build: that this job cannot run
 * quietly while the delivery signal it depends on is missing.
 */
function build({ bounceConfigured = true } = {}) {
  const consentService = {
    countActive: jest.fn().mockResolvedValue(3),
    findDueReminders: jest.fn().mockResolvedValue([]),
    sendReminder: jest.fn().mockResolvedValue({ sent: true, disabled: false }),
  };
  const bounceMailboxService = {
    isConfigured: jest.fn().mockReturnValue(bounceConfigured),
  };
  const errorLogService = {
    record: jest.fn<Promise<void>, [{ jobName: string; error: Error }]>(() =>
      Promise.resolve(),
    ),
  };
  const redisService = {
    tryClaimScheduledJobRun: jest.fn().mockResolvedValue(true),
  };
  const service = new PublicSharingReminderService(
    consentService as never,
    bounceMailboxService as never,
    errorLogService as never,
    redisService as never,
  );
  return {
    service,
    consentService,
    bounceMailboxService,
    errorLogService,
    redisService,
  };
}

const dueRow = (id: string) => ({ id }) as never;

describe('PublicSharingReminderService', () => {
  it('sends a reminder for every consent that is due', async () => {
    const { service, consentService } = build();
    consentService.findDueReminders.mockResolvedValue([
      dueRow('a'),
      dueRow('b'),
    ]);

    await service.sendDueReminders();

    expect(consentService.sendReminder).toHaveBeenCalledTimes(2);
  });

  it('does nothing when nothing is due', async () => {
    const { service, consentService, errorLogService } = build();

    await service.sendDueReminders();

    expect(consentService.sendReminder).not.toHaveBeenCalled();
    expect(errorLogService.record).not.toHaveBeenCalled();
  });

  it('does not write an error row when no consent exists to be unsupervised', async () => {
    // Security review 2026-08-19, second pass. With the allow-list empty
    // this would otherwise write one row a day, forever, saying nothing
    // is wrong — in the one channel that reports this gap.
    const { service, consentService, errorLogService } = build({
      bounceConfigured: false,
    });
    consentService.countActive.mockResolvedValue(0);

    await service.sendDueReminders();

    expect(errorLogService.record).not.toHaveBeenCalled();
  });

  it('still reports the unsupervised gap on a day nothing is due', async () => {
    // Security review 2026-08-19, finding 7. The alarm used to sit after
    // the `due.length === 0` early return, so on a small beta it only
    // fired on the handful of days a month a reminder happened to fall
    // due — close to the silence the ADR objected to. Missing bounce
    // detection is a standing condition, not a per-send event.
    const { service, consentService, errorLogService } = build({
      bounceConfigured: false,
    });
    consentService.findDueReminders.mockResolvedValue([]);
    consentService.countActive.mockResolvedValue(7);

    await service.sendDueReminders();

    expect(errorLogService.record).toHaveBeenCalledTimes(1);
    const recorded = errorLogService.record.mock.calls[0][0];
    // Counts live consents, not today's due ones — the number that says
    // how much is actually unsupervised.
    expect(recorded.error.message).toContain('7 active consent(s)');
  });

  it('skips the run when another replica already claimed it', async () => {
    // Two API pods fire every @Cron at the same instant; without the
    // claim both would mail every parent.
    const { service, consentService, redisService } = build();
    redisService.tryClaimScheduledJobRun.mockResolvedValue(false);

    await service.sendDueReminders();

    expect(consentService.findDueReminders).not.toHaveBeenCalled();
  });

  it('records a job failure on every run while bounce detection is off', async () => {
    // The ADR's whole objection to writing this job early: a sweep with
    // no delivery signal "would report healthy while the case it exists
    // to catch went undetected". It may run, but it may not run quietly.
    const { service, consentService, errorLogService } = build({
      bounceConfigured: false,
    });
    consentService.findDueReminders.mockResolvedValue([dueRow('a')]);

    await service.sendDueReminders();

    expect(errorLogService.record).toHaveBeenCalledTimes(1);
    const recorded = errorLogService.record.mock.calls[0][0];
    expect(recorded.jobName).toBe('public-sharing:reminder');
    expect(recorded.error.message).toContain('unsupervised');
  });

  it('still sends the reminders while degraded', async () => {
    // Withholding them would remove a control rather than add one: the
    // revoke link inside is the parent's only standing lever.
    const { service, consentService } = build({ bounceConfigured: false });
    consentService.findDueReminders.mockResolvedValue([dueRow('a')]);

    await service.sendDueReminders();

    expect(consentService.sendReminder).toHaveBeenCalledTimes(1);
  });

  it('says nothing when bounce detection IS configured', async () => {
    const { service, consentService, errorLogService } = build();
    consentService.findDueReminders.mockResolvedValue([dueRow('a')]);

    await service.sendDueReminders();

    expect(errorLogService.record).not.toHaveBeenCalled();
  });

  it("one family's failure does not stop everyone else's reminder", async () => {
    const { service, consentService } = build();
    consentService.findDueReminders.mockResolvedValue([
      dueRow('a'),
      dueRow('b'),
      dueRow('c'),
    ]);
    consentService.sendReminder.mockRejectedValueOnce(new Error('boom'));

    await service.sendDueReminders();

    expect(consentService.sendReminder).toHaveBeenCalledTimes(3);
  });

  it('records a failure when the sweep itself throws', async () => {
    const { service, consentService, errorLogService } = build();
    consentService.findDueReminders.mockRejectedValue(new Error('db down'));

    await service.sendDueReminders();

    expect(errorLogService.record).toHaveBeenCalledTimes(1);
    expect(errorLogService.record.mock.calls[0][0].jobName).toBe(
      'public-sharing:reminder',
    );
  });

  it('never rejects out of the handler when the sweep throws', async () => {
    // A rejected promise from a @Cron handler lands in the cron package's
    // bare console.error, detached from this app's logging entirely.
    //
    // Note what is NOT simulated here: `ErrorLogService.record` throwing
    // in turn. It cannot — it is written as a never-rethrows sink and
    // falls back to `logger.error` when its own insert fails, which is
    // the guarantee every @Cron handler in this codebase leans on.
    // Mocking it to reject would test a scenario the real collaborator
    // makes impossible.
    const { service, consentService } = build();
    consentService.findDueReminders.mockRejectedValue(new Error('x'));

    await expect(service.sendDueReminders()).resolves.toBeUndefined();
  });
});
