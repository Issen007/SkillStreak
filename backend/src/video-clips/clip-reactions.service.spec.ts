import { ClipNotFoundException } from '../common/errors/exceptions';
import { ClipReactionsService } from './clip-reactions.service';
import { ClipReactionType } from './entities/clip-reaction.entity';

/**
 * The decisions, not the SQL.
 *
 * What is worth pinning here is the set of rules that would each be a
 * real failure if they quietly changed: that a write re-checks public
 * visibility through the feed's own gate rather than a copy of it, that a
 * withdrawal deliberately does *not*, that tapping the same reaction
 * twice clears rather than duplicating, and that totals are refused for
 * anyone but the uploader. Every one of those is a sentence in ADR-0019
 * or the design doc that nothing else in the codebase enforces.
 */

const VIEWER = 'viewer-1';
const CLIP = 'clip-1';

function build(
  overrides: {
    existing?: { id: string; reactionType: ClipReactionType } | null;
    groupRows?: Array<{ reactionType: ClipReactionType; count: string }>;
  } = {},
) {
  const insert = {
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(undefined),
  };
  const groupQb = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(overrides.groupRows ?? []),
  };
  const reactions = {
    findOne: jest.fn().mockResolvedValue(overrides.existing ?? null),
    find: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn((alias?: string) =>
      alias === 'r' ? groupQb : { insert: jest.fn(() => insert) },
    ),
  };
  const feed = {
    assertPubliclyVisibleTo: jest
      .fn()
      .mockResolvedValue({ uploaderPlayerId: 'uploader-1' }),
    ownClipOrThrow: jest.fn().mockResolvedValue({ id: CLIP }),
  };
  const service = new ClipReactionsService(reactions as never, feed as never);
  return { service, reactions, feed, insert, groupQb };
}

describe('ClipReactionsService: writing a reaction', () => {
  it('re-checks public visibility through the feed gate, not a copy of it', async () => {
    const { service, feed } = build();

    await service.react(VIEWER, CLIP, ClipReactionType.NICE);

    expect(feed.assertPubliclyVisibleTo).toHaveBeenCalledWith(VIEWER, CLIP);
  });

  it('refuses when the clip is not publicly visible', async () => {
    // The case that matters: a parent revoked consent a moment ago. The
    // clip must stop being reactable in the same instant it stops being
    // visible, which only holds while both go through one gate.
    const { service, feed, reactions } = build();
    feed.assertPubliclyVisibleTo.mockRejectedValue(new ClipNotFoundException());

    await expect(
      service.react(VIEWER, CLIP, ClipReactionType.NICE),
    ).rejects.toBeInstanceOf(ClipNotFoundException);
    expect(reactions.update).not.toHaveBeenCalled();
    expect(reactions.delete).not.toHaveBeenCalled();
  });

  it('inserts when the viewer has not reacted yet', async () => {
    const { service, insert } = build({ existing: null });

    const result = await service.react(VIEWER, CLIP, ClipReactionType.STRONG);

    expect(insert.values).toHaveBeenCalledWith({
      clipId: CLIP,
      playerId: VIEWER,
      reactionType: ClipReactionType.STRONG,
    });
    // Concurrent double-tap must not surface as an error to a child.
    expect(insert.orIgnore).toHaveBeenCalled();
    expect(result).toEqual({ clipId: CLIP, reaction: ClipReactionType.STRONG });
  });

  it('replaces rather than adds when a different reaction is tapped', async () => {
    const { service, reactions, insert } = build({
      existing: { id: 'r-1', reactionType: ClipReactionType.NICE },
    });

    const result = await service.react(VIEWER, CLIP, ClipReactionType.CREATIVE);

    expect(reactions.update).toHaveBeenCalledWith(
      { id: 'r-1' },
      { reactionType: ClipReactionType.CREATIVE },
    );
    // One row per viewer per clip — the UNIQUE index's whole point.
    expect(insert.execute).not.toHaveBeenCalled();
    expect(result).toEqual({
      clipId: CLIP,
      reaction: ClipReactionType.CREATIVE,
    });
  });

  it('clears when the same reaction is tapped again', async () => {
    const { service, reactions } = build({
      existing: { id: 'r-1', reactionType: ClipReactionType.WELL_DONE },
    });

    const result = await service.react(
      VIEWER,
      CLIP,
      ClipReactionType.WELL_DONE,
    );

    expect(reactions.delete).toHaveBeenCalledWith({ id: 'r-1' });
    // Absence, not a stored "none" — one encoding per state.
    expect(result).toEqual({ clipId: CLIP, reaction: null });
  });
});

describe('ClipReactionsService: withdrawing', () => {
  it('does NOT require the clip to still be visible', async () => {
    // Deliberate. A viewer must be able to withdraw their own reaction
    // from a clip that has since been unpublished or lost consent —
    // refusing would strand a row they asked to remove.
    const { service, feed, reactions } = build();

    await service.clear(VIEWER, CLIP);

    expect(feed.assertPubliclyVisibleTo).not.toHaveBeenCalled();
    expect(reactions.delete).toHaveBeenCalledWith({
      clipId: CLIP,
      playerId: VIEWER,
    });
  });

  it('is idempotent — clearing nothing is not an error', async () => {
    const { service, reactions } = build();
    reactions.delete.mockResolvedValue({ affected: 0 });

    await expect(service.clear(VIEWER, CLIP)).resolves.toEqual({
      clipId: CLIP,
      reaction: null,
    });
  });
});

describe('ClipReactionsService: totals are uploader-only', () => {
  it('goes through the same ownership check publish/unpublish use', async () => {
    const { service, feed } = build();

    await service.totalsForOwnClip(VIEWER, CLIP);

    expect(feed.ownClipOrThrow).toHaveBeenCalledWith(VIEWER, CLIP);
  });

  it('refuses someone else’s clip, so this is not a public count endpoint', async () => {
    const { service, feed, groupQb } = build();
    feed.ownClipOrThrow.mockRejectedValue(new ClipNotFoundException());

    await expect(service.totalsForOwnClip(VIEWER, CLIP)).rejects.toBeInstanceOf(
      ClipNotFoundException,
    );
    // And critically: it must not have counted anything first.
    expect(groupQb.getRawMany).not.toHaveBeenCalled();
  });

  it('reports zero for reaction types nobody used', async () => {
    // A sparse GROUP BY must not become a sparse object — the Archive
    // renders four counters and a missing key would render undefined.
    const { service } = build({
      groupRows: [{ reactionType: ClipReactionType.NICE, count: '3' }],
    });

    await expect(service.totalsForOwnClip(VIEWER, CLIP)).resolves.toEqual({
      nice: 3,
      strong: 0,
      creative: 0,
      well_done: 0,
    });
  });
});

describe('ClipReactionsService: reading a feed page', () => {
  it('asks for nothing when the page is empty', async () => {
    const { service, reactions } = build();

    await expect(service.viewerReactionsFor(VIEWER, [])).resolves.toEqual(
      new Map(),
    );
    expect(reactions.find).not.toHaveBeenCalled();
  });

  it('resolves a whole page in one query, not one per card', async () => {
    const { service, reactions } = build();
    reactions.find.mockResolvedValue([
      { clipId: 'a', reactionType: ClipReactionType.NICE },
      { clipId: 'c', reactionType: ClipReactionType.STRONG },
    ]);

    const map = await service.viewerReactionsFor(VIEWER, ['a', 'b', 'c']);

    expect(reactions.find).toHaveBeenCalledTimes(1);
    expect(map.get('a')).toBe(ClipReactionType.NICE);
    expect(map.get('b')).toBeUndefined();
    expect(map.get('c')).toBe(ClipReactionType.STRONG);
  });
});
