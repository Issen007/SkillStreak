import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { CreateTrainerPostDto } from '../trainer-posts/dto/create-trainer-post.dto';
import { TrainingPlanStatus } from './entities/training-plan-draft.entity';
import { TrainingPlansController } from './training-plans.controller';

/**
 * ADR-0035 — a finished draft becomes a trainer post in the review queue.
 *
 * The property worth testing is not that it copies text. It is that the
 * server, not the caller, decides whether a post is marked as
 * machine-drafted — because that marking is what a reviewer uses to
 * decide how hard to read something, and it stands in front of children's
 * screens.
 */
function build(draftStatus: TrainingPlanStatus = TrainingPlanStatus.READY) {
  const create = jest
    .fn<
      Promise<{ id: string }>,
      [string, CreateTrainerPostDto, (string | null)?]
    >()
    .mockResolvedValue({ id: 'post-1' });
  const findSubmittableOwned = jest.fn().mockImplementation(() => {
    if (draftStatus !== TrainingPlanStatus.READY) {
      throw new Error('training_plan_not_ready');
    }
    return Promise.resolve({ id: 'draft-9', status: draftStatus });
  });
  const controller = new TrainingPlansController(
    { findSubmittableOwned } as never,
    { assertMayRead: jest.fn().mockResolvedValue(undefined) } as never,
    { create } as never,
  );
  return { controller, create, findSubmittableOwned };
}

function dto(overrides: Partial<CreateTrainerPostDto> = {}) {
  const d = new CreateTrainerPostDto();
  Object.assign(d, {
    title: 'Fem minuter teknik',
    body: 'Studsa bollen mot väggen i två minuter, byt hand, upprepa.',
    authorByline: 'Tränare Anna',
    ...overrides,
  });
  return d;
}

describe('POST /training-plans/:id/submit-as-post', () => {
  it('records the draft as the source, so a reviewer can see it is machine-drafted', async () => {
    const { controller, create } = build();

    await controller.submitAsPost('staff-1', 'pt' as never, 'draft-9', dto());

    expect(create).toHaveBeenCalledWith(
      'staff-1',
      expect.objectContaining({ title: 'Fem minuter teknik' }),
      'draft-9',
    );
  });

  // The load-bearing one. If the caller could set this, they could also
  // clear it — presenting model text to a reviewer as hand-written, which
  // is the single lie the column exists to prevent.
  //
  // **The fixture is a different draft id, not `null`, and that is the
  // whole test.** Written with `null` first, it passed against a
  // deliberately sabotaged controller that DID read the body
  // (`body.sourceTrainingPlanDraftId ?? draft.id` resolves to the draft
  // either way), so it proved nothing. A conflicting value is the only
  // fixture that can tell the two implementations apart.
  it('takes the source from the verified draft, never from the request body', async () => {
    const { controller, create } = build();

    await controller.submitAsPost(
      'staff-1',
      'pt' as never,
      'draft-9',
      dto({
        // A caller pointing provenance at somebody else's draft.
        sourceTrainingPlanDraftId: 'draft-belonging-to-nobody',
        machineDrafted: false,
      } as never),
    );

    expect(create.mock.calls[0][2]).toBe('draft-9');
  });

  it('submits the text the trainer sent, not the draft copied server-side', async () => {
    // Decision 2: the trainer is accountable for what they submit, which
    // is only true if what they edited is what gets submitted.
    const { controller, create } = build();
    const edited = dto({ body: 'Edited by a human who read it first.' });

    await controller.submitAsPost('staff-1', 'pt' as never, 'draft-9', edited);

    expect(create.mock.calls[0][1].body).toBe(
      'Edited by a human who read it first.',
    );
  });

  it('refuses a draft that has no text yet', async () => {
    const { controller, create } = build(TrainingPlanStatus.GENERATING);

    await expect(
      controller.submitAsPost('staff-1', 'pt' as never, 'draft-9', dto()),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('checks the team-invited gate before touching anything', async () => {
    const assertMayRead = jest.fn().mockRejectedValue(new Error('forbidden'));
    const findSubmittableOwned = jest.fn();
    const controller = new TrainingPlansController(
      { findSubmittableOwned } as never,
      { assertMayRead } as never,
      { create: jest.fn() } as never,
    );

    await expect(
      controller.submitAsPost('staff-1', 'pt' as never, 'draft-9', dto()),
    ).rejects.toThrow();
    expect(findSubmittableOwned).not.toHaveBeenCalled();
  });
});

describe('CreateTrainerPostDto on the submit route', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const meta = { type: 'body' as const, metatype: CreateTrainerPostDto };

  // There is no field for provenance, which is why the test above can
  // only assert the server sets it — `forbidNonWhitelisted` rejects the
  // attempt outright rather than ignoring it.
  it.each(['sourceTrainingPlanDraftId', 'machineDrafted', 'status'])(
    'refuses a body carrying %s',
    async (field) => {
      await expect(
        pipe.transform(
          {
            title: 'T',
            body: 'A body long enough to be a real tip for a child.',
            authorByline: 'Anna',
            [field]: 'anything',
          },
          meta,
        ),
      ).rejects.toThrow();
    },
  );
});
