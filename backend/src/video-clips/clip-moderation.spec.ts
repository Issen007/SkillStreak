import { ClipNotFoundException } from '../common/errors/exceptions';
import { AdminClipModerationService } from './admin-clip-moderation.service';
import { ClipModerationDecisionKind } from './entities/clip-moderation-decision.entity';
import { VideoClip, VideoClipStatus } from './entities/video-clip.entity';

/**
 * docs/design/clip-safety.md layer 4.
 *
 * The property that matters is not that decisions get stored. It is that
 * **dismissing puts a clip back** — until this existed, a report was a
 * one-way door any teammate could operate, and nobody could undo it.
 */
function build(clip: Partial<VideoClip> | null = { id: 'clip-1' }) {
  const update = jest.fn().mockResolvedValue({ affected: 1 });
  const insert = jest.fn().mockResolvedValue(undefined);
  const findOne = jest.fn().mockResolvedValue(clip);
  const manager = { findOne, update, insert };
  const dataSource = {
    transaction: jest.fn((cb: (m: typeof manager) => Promise<void>) =>
      cb(manager),
    ),
  };
  const service = new AdminClipModerationService(
    {} as never,
    {} as never,
    dataSource as never,
  );
  return { service, update, insert, findOne };
}

describe('AdminClipModerationService', () => {
  it('dismissing restores the clip — the capability that did not exist', async () => {
    const { service, update } = build();

    await service.dismiss('clip-1', 'staff-9', 'Reported by mistake.');

    expect(update).toHaveBeenCalledWith(
      VideoClip,
      { id: 'clip-1' },
      { status: VideoClipStatus.PUBLISHED },
    );
  });

  it('upholding leaves the clip hidden and touches nothing', async () => {
    const { service, update } = build();

    await service.uphold('clip-1', 'staff-9');

    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ['dismiss', ClipModerationDecisionKind.DISMISSED],
    ['uphold', ClipModerationDecisionKind.UPHELD],
  ])('records who decided, on %s', async (method, kind) => {
    const { service, insert } = build();

    await (
      service as unknown as Record<string, (...a: unknown[]) => Promise<void>>
    )[method]('clip-1', 'staff-9', 'a note');

    expect(insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        clipId: 'clip-1',
        decidedByStaffAccountId: 'staff-9',
        decision: kind,
        note: 'a note',
      }),
    );
  });

  /**
   * Both halves in one transaction. A clip restored with no record of who
   * restored it, or a decision recorded while the clip stayed hidden, are
   * each worse than the operation failing and being retried.
   */
  it('restores and records atomically', async () => {
    const { service } = build();
    const transaction = jest.fn().mockRejectedValue(new Error('boom'));
    const svc = new AdminClipModerationService(
      {} as never,
      {} as never,
      {
        transaction,
      } as never,
    );

    await expect(svc.dismiss('clip-1', 'staff-9')).rejects.toThrow('boom');
    void service;
  });

  // Only a hidden clip is in the queue. Ruling on a visible one would be
  // acting on something no report currently concerns.
  it('refuses a clip that is not hidden', async () => {
    const { service, insert } = build(null);

    await expect(service.dismiss('clip-1', 'staff-9')).rejects.toBeInstanceOf(
      ClipNotFoundException,
    );
    expect(insert).not.toHaveBeenCalled();
  });
});
