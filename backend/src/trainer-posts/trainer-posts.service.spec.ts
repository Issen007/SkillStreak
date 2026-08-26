import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  TrainerPostForbiddenContentException,
  TrainerPostNotFoundException,
} from '../common/errors/exceptions';
import { TrainerPost, TrainerPostStatus } from './entities/trainer-post.entity';
import { TrainerPostsService } from './trainer-posts.service';

const AUTHOR = '11111111-1111-1111-1111-111111111111';
const REVIEWER = '22222222-2222-2222-2222-222222222222';
const POST_ID = '33333333-3333-3333-3333-333333333333';

describe('TrainerPostsService', () => {
  let service: TrainerPostsService;
  let save: jest.Mock;
  let findOne: jest.Mock;
  let find: jest.Mock;
  let del: jest.Mock;

  const valid = {
    title: 'Tre sätt att träna passningar hemma',
    body: 'En kort text om hur du kan träna passningar mot en vägg när du inte har någon att spela med.',
    authorByline: 'Anna, tränare i Uppsala',
  };

  beforeEach(async () => {
    save = jest.fn().mockImplementation((e: Partial<TrainerPost>) => ({
      id: POST_ID,
      createdAt: new Date('2026-08-13T10:00:00Z'),
      publishedAt: null,
      rejectionReason: null,
      reviewedByStaffAccountId: null,
      reviewedAt: null,
      ...e,
    }));
    findOne = jest.fn().mockResolvedValue(null);
    find = jest.fn().mockResolvedValue([]);
    del = jest.fn().mockResolvedValue({ affected: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrainerPostsService,
        {
          provide: getRepositoryToken(TrainerPost),
          useValue: {
            save,
            findOne,
            find,
            delete: del,
            create: (e: unknown) => e,
          },
        },
      ],
    }).compile();

    service = module.get(TrainerPostsService);
  });

  describe('what an author may publish', () => {
    it('accepts a tip that says who the trainer is', async () => {
      // Self-promotion is explicitly allowed: a name and a town is how a
      // good trainer gets found, and it carries no way to reach them.
      const view = await service.create(AUTHOR, valid);
      expect(view.authorByline).toBe('Anna, tränare i Uppsala');
      expect(view.status).toBe(TrainerPostStatus.PENDING_REVIEW);
    });

    it('always starts pending, whatever the author sends', async () => {
      // There is no argument that publishes a post. The enum has no
      // author-controlled transition to `published`, and this pins it.
      await service.create(AUTHOR, {
        ...valid,
        ...({ status: 'published' } as never),
      });
      expect((save.mock.calls[0] as [{ status: string }])[0].status).toBe(
        TrainerPostStatus.PENDING_REVIEW,
      );
    });

    it.each([
      [
        'a booking link in the body',
        {
          body: 'Boka på https://coach.example.com och kom igång idag med mig',
        },
      ],
      [
        'a bare domain',
        {
          body: 'Läs mer på www.mintranare.se om du vill veta mer om upplägget',
        },
      ],
      [
        'an email address',
        {
          body: 'Hör av dig till anna@example.com så bokar vi in ett pass tillsammans',
        },
      ],
      ['a link in the title', { title: 'Boka på coach.example.com' }],
      ['a link in the byline', { authorByline: 'Anna — www.anna.se' }],
    ])('refuses %s', async (_name, override) => {
      // The no-links rule is what keeps "self-promotion" from becoming a
      // channel, and it is also how "no transactions" is enforced: a
      // booking link is a URL. Checked on every author-supplied field,
      // not just the body.
      await expect(
        service.create(AUTHOR, { ...valid, ...override }),
      ).rejects.toBeInstanceOf(TrainerPostForbiddenContentException);
    });

    it('names the field so the author can fix it', async () => {
      // A vague rejection just gets retried. This one IS the author's to
      // fix, unlike most refusals in this app.
      await expect(
        service.create(AUTHOR, { ...valid, authorByline: 'Anna www.a.se' }),
      ).rejects.toThrow(/authorByline/);
    });
  });

  describe('the review gate', () => {
    it('publishes only from pending, and records who did it', async () => {
      findOne.mockResolvedValue({
        ...valid,
        id: POST_ID,
        status: TrainerPostStatus.PENDING_REVIEW,
        createdAt: new Date(),
      });

      const view = await service.publish(REVIEWER, POST_ID);

      expect(view.status).toBe(TrainerPostStatus.PUBLISHED);
      const saved = (save.mock.calls[0] as [TrainerPost])[0];
      expect(saved.reviewedByStaffAccountId).toBe(REVIEWER);
      expect(saved.publishedAt).toBeInstanceOf(Date);
    });

    it('re-checks the content rule at publish, not only at create', async () => {
      // A post can sit in the queue across a change to what counts as a
      // contact detail. What reaches a child's screen is what must be
      // clean, so the check runs where that decision is made.
      findOne.mockResolvedValue({
        ...valid,
        body: 'Boka på https://coach.example.com',
        id: POST_ID,
        status: TrainerPostStatus.PENDING_REVIEW,
        createdAt: new Date(),
      });

      await expect(service.publish(REVIEWER, POST_ID)).rejects.toBeInstanceOf(
        TrainerPostForbiddenContentException,
      );
    });

    it('refuses to publish something already published', async () => {
      findOne.mockResolvedValue({
        ...valid,
        id: POST_ID,
        status: TrainerPostStatus.PUBLISHED,
        createdAt: new Date(),
      });
      await expect(service.publish(REVIEWER, POST_ID)).rejects.toBeInstanceOf(
        TrainerPostNotFoundException,
      );
    });

    it('takes a published post back off the feed', async () => {
      // "We approved it and should not have" needs a faster path than
      // deleting a row, and the author should be able to see what
      // happened — so it returns to rejected rather than vanishing.
      findOne.mockResolvedValue({
        ...valid,
        id: POST_ID,
        status: TrainerPostStatus.PUBLISHED,
        createdAt: new Date(),
        publishedAt: new Date(),
      });

      const view = await service.unpublish(REVIEWER, POST_ID, 'Not suitable');

      expect(view.status).toBe(TrainerPostStatus.REJECTED);
      expect(view.publishedAt).toBeNull();
      expect(view.rejectionReason).toBe('Not suitable');
    });
  });

  describe('what a reader sees', () => {
    it('returns only published posts', async () => {
      await service.listPublished();
      expect(
        (find.mock.calls[0] as [{ where: { status: string } }])[0].where,
      ).toEqual({ status: TrainerPostStatus.PUBLISHED });
    });

    it('never exposes the reviewer or a rejection reason', async () => {
      // A reader has no business knowing who approved a post or what was
      // said about a rejected one.
      find.mockResolvedValue([
        {
          ...valid,
          id: POST_ID,
          locale: 'sv',
          ageBand: null,
          focus: null,
          status: TrainerPostStatus.PUBLISHED,
          reviewedByStaffAccountId: REVIEWER,
          rejectionReason: 'internal note',
          createdAt: new Date(),
          publishedAt: new Date(),
        },
      ]);

      const [post] = await service.listPublished();
      const serialised = JSON.stringify(post);
      expect(serialised).not.toContain(REVIEWER);
      expect(serialised).not.toContain('internal note');
      expect(post).not.toHaveProperty('status');
    });

    it('bounds the page size whatever is asked for', async () => {
      await service.listPublished(100000);
      expect((find.mock.calls[0] as [{ take: number }])[0].take).toBe(100);
    });
  });

  describe('an author deleting their own', () => {
    it('scopes the delete to the caller', async () => {
      await service.deleteOwn(AUTHOR, POST_ID);
      expect(del).toHaveBeenCalledWith({
        id: POST_ID,
        authorStaffAccountId: AUTHOR,
      });
    });

    it('refuses a post that is not theirs', async () => {
      del.mockResolvedValue({ affected: 0 });
      await expect(service.deleteOwn(AUTHOR, POST_ID)).rejects.toBeInstanceOf(
        TrainerPostNotFoundException,
      );
    });
  });

  /**
   * ADR-0035 Decision 3 — provenance reaches the reviewer and stops
   * there.
   *
   * The third test is the one that matters. `TrainerPostPublicView` is
   * what children read, and the ADR deliberately leaves "what is a child
   * told about machine-drafted text" open for ux-designer and the
   * project owner. Leaking the flag into the reader's payload would
   * settle that question quietly, by accident, in the direction nobody
   * argued for.
   */
  describe('machine-drafted provenance (ADR-0035)', () => {
    /** `save.mock.calls` is `any[]`; narrowed once so the assertions
     *  below are actually type-checked rather than silently `any`. */
    const savedPost = (): Partial<TrainerPost> => {
      const calls = save.mock.calls as unknown as Partial<TrainerPost>[][];
      return calls[0][0];
    };

    it('marks a post machine-drafted when it came from a plan draft', async () => {
      const view = await service.create(AUTHOR, valid, 'draft-9');

      expect(view.machineDrafted).toBe(true);
      expect(savedPost().sourceTrainingPlanDraftId).toBe('draft-9');
    });

    it('marks a hand-written post as not machine-drafted', async () => {
      const view = await service.create(AUTHOR, valid);

      expect(view.machineDrafted).toBe(false);
      expect(savedPost().sourceTrainingPlanDraftId).toBeNull();
    });

    it('still enters the review queue, exactly like any other post', async () => {
      // The whole reason Tier A reverses no ADR: machine-drafted text
      // gets no shortcut past the operator.
      await service.create(AUTHOR, valid, 'draft-9');

      expect(savedPost().status).toBe(TrainerPostStatus.PENDING_REVIEW);
    });

    it('never puts provenance in the payload children read', async () => {
      find.mockResolvedValue([
        {
          id: POST_ID,
          ...valid,
          locale: 'sv',
          ageBand: null,
          focus: null,
          status: TrainerPostStatus.PUBLISHED,
          publishedAt: new Date('2026-08-24T10:00:00Z'),
          createdAt: new Date('2026-08-24T09:00:00Z'),
          rejectionReason: null,
          sourceTrainingPlanDraftId: 'draft-9',
        },
      ]);

      const [publicView] = await service.listPublished();

      expect(publicView).not.toHaveProperty('machineDrafted');
      expect(publicView).not.toHaveProperty('sourceTrainingPlanDraftId');
    });
  });
});
