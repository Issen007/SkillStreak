import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventRegistration } from './entities/event-registration.entity';
import {
  EventRegistrationInterest,
  EventRegistrationLocale,
} from './entities/event-registration.entity';
import { MailService } from '../mail/mail.service';
import { EventRegistrationsService } from './event-registrations.service';

/** Typed read of a sendMail mock call — keeps the assertions below free of
 *  `any`, which the lint rules reject in this repo. */
interface SentMail {
  to: string;
  text: string;
  attachments?: Array<{ filename: string; content: string }>;
}

function sentMails(mock: jest.Mock): SentMail[] {
  return mock.mock.calls.map((call) => (call as [SentMail])[0]);
}

describe('EventRegistrationsService', () => {
  let service: EventRegistrationsService;
  let values: jest.Mock;
  let execute: jest.Mock;
  let find: jest.Mock;
  let del: jest.Mock;
  let update: jest.Mock;
  let sendMail: jest.Mock;

  const dto = {
    name: '  Anna Svensson  ',
    email: '  Anna.Svensson@Example.SE ',
    interest: EventRegistrationInterest.TRAINER,
    locale: EventRegistrationLocale.SV,
    privacyAccepted: true as const,
  };

  beforeEach(async () => {
    execute = jest.fn().mockResolvedValue({ identifiers: [] });
    values = jest.fn().mockReturnThis();
    find = jest.fn().mockResolvedValue([]);
    del = jest.fn().mockResolvedValue({ affected: 1 });
    update = jest.fn().mockResolvedValue({ affected: 2 });
    sendMail = jest.fn().mockResolvedValue(undefined);

    const queryBuilder = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values,
      orIgnore: jest.fn().mockReturnThis(),
      execute,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventRegistrationsService,
        {
          provide: getRepositoryToken(EventRegistration),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
            find,
            delete: del,
            update,
            findOne: jest.fn().mockResolvedValue({
              email: 'anna.svensson@example.se',
              locale: 'sv',
              unsubscribeCode: 'code-1',
            }),
          },
        },
        {
          provide: MailService,
          useValue: { sendMail: sendMail },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('https://api.skillstreak.xyz/'),
          },
        },
      ],
    }).compile();

    service = module.get(EventRegistrationsService);
  });

  it('normalises the email so the unique index means one person', async () => {
    await service.register({ ...dto });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'anna.svensson@example.se',
        name: 'Anna Svensson',
      }),
    );
  });

  it('records when consent was given, not merely that it was', async () => {
    await service.register({ ...dto });

    const [written] = values.mock.calls[0] as [{ privacyAcceptedAt: Date }];
    expect(written.privacyAcceptedAt).toBeInstanceOf(Date);
  });

  it('stores blank optional text as null rather than an empty string', async () => {
    await service.register({ ...dto, note: '   ', campaign: '  ' });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ note: null, campaign: null }),
    );
  });

  it('silently drops a honeypot submission but still answers as if it worked', async () => {
    const result = await service.register({ ...dto, website: 'http://spam' });

    // Both halves matter: nothing written, and nothing that tells the bot
    // it was caught.
    expect(execute).not.toHaveBeenCalled();
    expect(result).toEqual({ registered: true });
  });

  it('answers identically for a duplicate, so the form is not an address oracle', async () => {
    execute.mockResolvedValue({ identifiers: [] }); // orIgnore swallowed it

    await expect(service.register({ ...dto })).resolves.toEqual({
      registered: true,
    });
  });

  it('deletes for real — a consent-based list must be able to forget', async () => {
    await expect(service.remove('id-1')).resolves.toEqual({ deleted: true });
    expect(del).toHaveBeenCalledWith({ id: 'id-1' });
  });

  it('reports a delete that matched nothing', async () => {
    del.mockResolvedValue({ affected: 0 });

    await expect(service.remove('gone')).resolves.toEqual({ deleted: false });
  });

  it('lists newest first', async () => {
    await service.list();

    expect(find).toHaveBeenCalledWith({ order: { createdAt: 'DESC' } });
  });

  describe('the send list', () => {
    it('exposes invite state and a usable unsubscribe URL per row', async () => {
      find.mockResolvedValue([
        {
          id: 'r1',
          name: 'Anna',
          email: 'anna@example.se',
          interest: EventRegistrationInterest.CURIOUS,
          note: null,
          locale: EventRegistrationLocale.SV,
          campaign: null,
          createdAt: new Date('2026-08-10T09:00:00Z'),
          inviteSentAt: null,
          unsubscribeCode: 'abc123',
        },
      ]);

      const [row] = await service.list();

      expect(row.inviteSentAt).toBeNull();
      // The trailing slash on APP_PUBLIC_URL must not produce a double
      // slash — this link goes into real email, where it cannot be fixed.
      expect(row.unsubscribeUrl).toBe(
        'https://api.skillstreak.xyz/api/v1/event-registrations/unsubscribe/abc123',
      );
    });

    it('marks only the ids given, and only ones not already invited', async () => {
      await service.markInvited(['a', 'b']);

      const [criteria, patch] = update.mock.calls[0] as [
        Record<string, unknown>,
        { inviteSentAt: Date },
      ];
      // Re-marking would rewrite the date of an invitation actually sent
      // earlier, and that date is the only record of when someone was
      // contacted.
      expect(Object.keys(criteria).sort()).toEqual(['id', 'inviteSentAt']);
      expect(patch.inviteSentAt).toBeInstanceOf(Date);
    });

    it('does not issue an update for an empty id list', async () => {
      await expect(service.markInvited([])).resolves.toEqual({ marked: 0 });
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribing', () => {
    it('deletes the row rather than flagging it', async () => {
      await expect(service.unsubscribe('code-1')).resolves.toEqual({
        removed: true,
      });
      // A tombstone would mean keeping the address specifically after
      // someone asked us to stop.
      expect(del).toHaveBeenCalledWith({ unsubscribeCode: 'code-1' });
    });

    it('reports an unknown code without throwing', async () => {
      del.mockResolvedValue({ affected: 0 });

      await expect(service.unsubscribe('nope')).resolves.toEqual({
        removed: false,
      });
    });
  });

  describe('sending the invitations', () => {
    const invite = {
      meetUrl: 'https://meet.google.com/abc-defg-hij',
      startsAt: '2026-09-03T17:00:00.000Z',
      durationMinutes: 30,
    };

    function registration(overrides: Record<string, unknown> = {}) {
      return {
        id: 'r1',
        name: 'Anna',
        email: 'anna@example.se',
        interest: EventRegistrationInterest.CURIOUS,
        note: null,
        locale: EventRegistrationLocale.SV,
        campaign: null,
        createdAt: new Date('2026-08-01T09:00:00Z'),
        inviteSentAt: null,
        unsubscribeCode: 'code-1',
        ...overrides,
      };
    }

    it('skips anyone already invited unless resend is asked for', async () => {
      find.mockResolvedValue([
        registration(),
        registration({ id: 'r2', inviteSentAt: new Date() }),
      ]);

      const result = await service.sendInvites(invite);

      expect(result).toEqual({ sent: 1, failed: 0, skipped: 1 });
      expect(sendMail).toHaveBeenCalledTimes(1);
    });

    it('re-sends to everyone when explicitly asked', async () => {
      find.mockResolvedValue([
        registration(),
        registration({ id: 'r2', inviteSentAt: new Date() }),
      ]);

      const result = await service.sendInvites({ ...invite, resend: true });

      expect(result).toEqual({ sent: 2, failed: 0, skipped: 0 });
    });

    it('sends one message per recipient, never a shared BCC', async () => {
      find.mockResolvedValue([
        registration(),
        registration({ id: 'r2', email: 'bo@example.se' }),
      ]);

      await service.sendInvites(invite);

      const recipients = sentMails(sendMail).map((mail) => mail.to);
      expect(recipients).toEqual(['anna@example.se', 'bo@example.se']);
      // Each message carries that person's own opt-out, which a shared
      // BCC could not do.
      const bodies = sentMails(sendMail).map((mail) => mail.text);
      expect(bodies.every((body) => body.includes('code-1'))).toBe(true);
    });

    it('attaches a calendar file with the Meet link in it', async () => {
      find.mockResolvedValue([registration()]);

      await service.sendInvites(invite);

      const attachments = sentMails(sendMail)[0].attachments ?? [];
      expect(attachments[0].filename).toBe('skillstreak-demo.ics');
      expect(attachments[0].content).toContain('meet.google.com/abc-defg-hij');
      expect(attachments[0].content).toContain('DTSTART:20260903T170000Z');
    });

    it('stamps each recipient as it succeeds, not the batch at the end', async () => {
      find.mockResolvedValue([
        registration(),
        registration({ id: 'r2', email: 'bo@example.se' }),
      ]);

      await service.sendInvites(invite);

      // Per-recipient: a crash halfway through must not re-mail the people
      // already contacted, and must not skip the ones never reached.
      expect(update).toHaveBeenCalledTimes(2);
      const [firstCriteria, firstPatch] = update.mock.calls[0] as [
        { id: string },
        { inviteSentAt: Date },
      ];
      expect(firstCriteria).toEqual({ id: 'r1' });
      expect(firstPatch.inviteSentAt).toBeInstanceOf(Date);
    });

    it('carries on past a failing recipient and leaves them unsent', async () => {
      find.mockResolvedValue([
        registration(),
        registration({ id: 'r2', email: 'bad@example.se' }),
      ]);
      sendMail
        .mockRejectedValueOnce(new Error('mailbox full'))
        .mockResolvedValue(undefined);

      const result = await service.sendInvites(invite);

      expect(result).toEqual({ sent: 1, failed: 1, skipped: 0 });
      // Only the one that succeeded got stamped, so the next run retries
      // exactly the failure and nobody else.
      expect(update).toHaveBeenCalledTimes(1);
      const [criteria, patch] = update.mock.calls[0] as [
        { id: string },
        { inviteSentAt: Date },
      ];
      expect(criteria).toEqual({ id: 'r2' });
      expect(patch.inviteSentAt).toBeInstanceOf(Date);
    });

    it('writes the time in the recipient own language, naming the timezone', async () => {
      find.mockResolvedValue([
        registration(),
        registration({
          id: 'r2',
          email: 'bo@example.com',
          locale: EventRegistrationLocale.EN,
        }),
      ]);

      await service.sendInvites(invite);

      const bodies = sentMails(sendMail).map((mail) => mail.text);
      // Stockholm is named rather than silently converted — a reader
      // abroad should not have to guess whose clock this is.
      expect(bodies[0]).toContain('(Stockholm)');
      expect(bodies[1]).toContain('(Stockholm)');
      expect(bodies[0]).not.toEqual(bodies[1]);
    });
  });

  describe('the signup confirmation', () => {
    it('never fails the registration when mail is broken', async () => {
      find.mockResolvedValue([]);
      sendMail.mockRejectedValue(new Error('smtp down'));

      await expect(service.register({ ...dto })).resolves.toEqual({
        registered: true,
      });
    });
  });
});
