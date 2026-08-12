import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DrillLibraryService } from '../drills/drill-library.service';
import { TrainingPlanNotFoundException } from '../common/errors/exceptions';
import { TrainingPlanDraft } from './entities/training-plan-draft.entity';
import { TrainingPlansService } from './training-plans.service';

const OWNER = '11111111-1111-1111-1111-111111111111';

describe('TrainingPlansService', () => {
  let service: TrainingPlansService;
  let save: jest.Mock;
  let count: jest.Mock;
  let findOne: jest.Mock;
  let query: jest.Mock;
  let config: Record<string, string>;

  const drill = {
    slug: 'kortpassningar-under-press',
    title: 'Kortpassningar under press',
    ageBand: '9-11',
    focus: 'passning',
    durationMinutes: 15,
    locale: 'sv',
    author: 'Anonym tränare',
    sourceNote: null,
    body: 'En enkel passningsövning.',
  };

  beforeEach(async () => {
    config = {};
    count = jest.fn().mockResolvedValue(0);
    findOne = jest.fn().mockResolvedValue(null);
    save = jest.fn().mockImplementation((entity) => ({
      id: 'plan-1',
      createdAt: new Date('2026-08-12T20:00:00Z'),
      completedAt: null,
      generatedPlan: null,
      modelId: null,
      corpusVersion: null,
      failureReason: null,
      ...entity,
    }));
    query = jest.fn().mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrainingPlansService,
        { provide: DataSource, useValue: { query } },
        { provide: ConfigService, useValue: { get: (k: string) => config[k] } },
        {
          provide: DrillLibraryService,
          useValue: {
            list: () => [{ slug: drill.slug }],
            findBySlug: () => drill,
          },
        },
        {
          provide: getRepositoryToken(TrainingPlanDraft),
          useValue: { save, count, findOne, find: jest.fn(), create: (e: unknown) => e },
        },
      ],
    }).compile();

    service = module.get(TrainingPlansService);
  });

  const dto = {
    promptText: '  kul pass med mycket rörelse  ',
    ageBand: '9-11',
    durationMinutes: 45,
  };

  describe('requesting', () => {
    it('queues a plan and trims the prompt', async () => {
      const view = await service.request(OWNER, dto);
      expect(view.status).toBe('queued');
      expect(save.mock.calls[0][0].promptText).toBe(
        'kul pass med mycket rörelse',
      );
    });

    it('never returns the lease id to the coach', async () => {
      // The lease is the generator's handle, not the coach's, and it is
      // the value a replayed result would need.
      const view = await service.request(OWNER, dto);
      expect(view).not.toHaveProperty('leaseId');
      expect(JSON.stringify(view)).not.toContain('lease');
    });

    it('refuses once a coach has too many waiting', async () => {
      count.mockResolvedValue(3);
      await expect(service.request(OWNER, dto)).rejects.toBeInstanceOf(
        TrainingPlanNotFoundException,
      );
    });
  });

  describe('what the generator is handed', () => {
    beforeEach(() => {
      query.mockResolvedValue([
        {
          lease_id: '22222222-2222-2222-2222-222222222222',
          prompt_text: 'kul pass',
          age_band: '9-11',
          duration_minutes: 45,
          focus: null,
          locale: 'sv',
        },
      ]);
    });

    it('sends the whole corpus, since there is no retrieval step', async () => {
      const job = await service.leaseNext();
      expect(job?.drills).toHaveLength(1);
      expect(job?.drills[0].body).toBe('En enkel passningsövning.');
    });

    it('names the corpus so a stored plan can be traced to it', async () => {
      const job = await service.leaseNext();
      expect(job?.corpusVersion).toBe('1:kortpassningar-under-press');
    });

    it('carries no staff account, no draft id and nothing child-scoped', async () => {
      // ADR-0028 Decision 7(c)'s structural control, asserted rather than
      // trusted: the payload is the coach's own words plus enums plus
      // adult-authored drills, and nothing else.
      const job = await service.leaseNext();
      const serialised = JSON.stringify(job);
      expect(serialised).not.toContain(OWNER);
      expect(serialised).not.toContain('plan-1');
      expect(serialised).not.toContain('staffAccountId');
      expect(serialised).not.toContain('teamId');
      expect(serialised).not.toContain('playerId');
    });

    it('returns null when there is nothing queued', async () => {
      query.mockResolvedValue([]);
      expect(await service.leaseNext()).toBeNull();
    });
  });

  describe('failure handling', () => {
    it('requeues below the attempt cap', async () => {
      query.mockResolvedValueOnce([{ id: 'plan-1', attempts: 1 }]);
      await service.reportFailure('22222222-2222-2222-2222-222222222222');
      expect(query.mock.calls[1][1][1]).toBe('queued');
    });

    it('gives up at the cap, with a phrase a coach can read', async () => {
      // Never the model's error: "CUDA out of memory" tells a coach
      // nothing they can act on and leaks the cluster's internals into an
      // adult's work-product list.
      query.mockResolvedValueOnce([{ id: 'plan-1', attempts: 3 }]);
      await service.reportFailure('22222222-2222-2222-2222-222222222222');
      expect(query.mock.calls[1][1][1]).toBe('failed');
      expect(query.mock.calls[1][1][2]).toBe(
        'The generator could not produce a plan this time.',
      );
    });

    it('ignores a lease it does not recognise', async () => {
      query.mockResolvedValueOnce([]);
      expect(
        (await service.reportFailure('22222222-2222-2222-2222-222222222222'))
          .applied,
      ).toBe(false);
    });
  });

  describe('ownership', () => {
    it('refuses a plan belonging to someone else', async () => {
      findOne.mockResolvedValue(null);
      await expect(
        service.findOwned(OWNER, '33333333-3333-3333-3333-333333333333'),
      ).rejects.toBeInstanceOf(TrainingPlanNotFoundException);
    });

    it('rejects a malformed id without reaching Postgres', async () => {
      await expect(service.findOwned(OWNER, 'nope')).rejects.toBeInstanceOf(
        TrainingPlanNotFoundException,
      );
      expect(findOne).not.toHaveBeenCalled();
    });
  });
});
