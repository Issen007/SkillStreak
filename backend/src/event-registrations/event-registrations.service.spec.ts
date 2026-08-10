import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventRegistration } from './entities/event-registration.entity';
import {
  EventRegistrationInterest,
  EventRegistrationLocale,
} from './entities/event-registration.entity';
import { EventRegistrationsService } from './event-registrations.service';

describe('EventRegistrationsService', () => {
  let service: EventRegistrationsService;
  let values: jest.Mock;
  let execute: jest.Mock;
  let find: jest.Mock;
  let del: jest.Mock;

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
});
