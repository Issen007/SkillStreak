import { ClipNotFoundException } from '../common/errors/exceptions';
import { AdminPublicClipReviewService } from './admin-public-clip-review.service';
import { PublicClipReviewStatus } from './entities/video-clip.entity';

/**
 * docs/design/clip-safety.md layer 3 — a person watches a clip before any
 * stranger can.
 *
 * The property under test is not "the queue works". It is that a clip a
 * child asked to publish is **not visible until an operator said yes**,
 * and that a rejection is legible to the child rather than a silent
 * undo.
 */
function build() {
  /* `mock.calls` is `any[]`; typed here so the assertions below are
   * actually checked rather than silently `any`. */
  const update = jest
    .fn<
      Promise<{ affected: number }>,
      [Record<string, unknown>, Record<string, unknown>]
    >()
    .mockResolvedValue({ affected: 1 });
  const service = new AdminPublicClipReviewService({
    update,
  } as never);
  return { service, update };
}

describe('AdminPublicClipReviewService', () => {
  it('records who approved it, not just that it was approved', async () => {
    const { service, update } = build();

    await service.approve('clip-1', 'staff-9');

    const fields = update.mock.calls[0][1];
    expect(fields.publicReviewStatus).toBe(PublicClipReviewStatus.APPROVED);
    expect(fields.publicReviewedByStaffAccountId).toBe('staff-9');
    expect(fields.publicReviewedAt).toBeInstanceOf(Date);
  });

  it('keeps the rejection reason, because the uploader is a child owed one', async () => {
    const { service, update } = build();

    await service.reject('clip-1', 'staff-9', '  Someone else is in shot.  ');

    const fields = update.mock.calls[0][1];
    expect(fields.publicReviewStatus).toBe(PublicClipReviewStatus.REJECTED);
    expect(fields.publicReviewRejectionReason).toBe('Someone else is in shot.');
  });

  /**
   * A rejected clip must stay distinguishable from one nobody ever tried
   * to publish. Clearing `published_publicly_at` would erase the request
   * itself, and the child would see their action undone with no trace and
   * no explanation.
   */
  it('never clears the record that the child asked', async () => {
    const { service, update } = build();

    await service.reject('clip-1', 'staff-9', 'Not suitable.');

    const fields = update.mock.calls[0][1];
    expect(fields).not.toHaveProperty('publishedPubliclyAt');
  });

  // Without this, a stray or guessed id would mark an unrelated private
  // clip as reviewed — a clip nobody ever asked to make public.
  it('only rules on a clip somebody actually asked to publish', async () => {
    const { service, update } = build();

    await service.approve('clip-1', 'staff-9');

    const where = update.mock.calls[0][0];
    expect(where).toHaveProperty('publishedPubliclyAt');
  });

  it('refuses when nothing matched, rather than reporting a decision it did not make', async () => {
    const update = jest.fn().mockResolvedValue({ affected: 0 });
    const service = new AdminPublicClipReviewService({ update } as never);

    await expect(service.approve('nope', 'staff-9')).rejects.toBeInstanceOf(
      ClipNotFoundException,
    );
  });
});
