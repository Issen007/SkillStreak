import { ClipNotFoundException } from '../common/errors/exceptions';
import { PublicFeedService } from './public-feed.service';

/**
 * Sparade — ADR-0019 Decision 6's re-validation rule.
 *
 * The rule is one sentence and the reason it matters is the whole
 * feature: a bookmark is a pointer, never a copy. Between saving and
 * opening, the clip may have been un-published, lost its family's
 * consent, been reported off the feed, or been swept. Rendering from the
 * stored row would hand a child a private copy of another child's video
 * that outlived their decision to withdraw it.
 *
 * These tests exist because that failure is invisible: a cached Sparade
 * grid looks *better* than a correct one, right up until it is showing
 * something a family revoked.
 */

const VIEWER = 'viewer-1';
const TEAM = 'team-1';

function build(opts: {
  saved: string[];
  stillVisible: string[];
  allowListed?: boolean;
}) {
  const rows = opts.stillVisible.map((id) => ({
    clipId: id,
    durationSeconds: 10,
    publishedAt: new Date('2026-08-01T00:00:00Z'),
    caption: null,
    storageKey: `k/${id}`,
    screenName: 'Someone',
    avatarId: null,
  }));
  const qb: Record<string, jest.Mock> = {};
  for (const m of ['innerJoin', 'select', 'where', 'andWhere']) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getRawMany = jest.fn().mockResolvedValue(rows);

  const clips = { createQueryBuilder: jest.fn(() => qb) };
  const players = {
    findOne: jest.fn().mockResolvedValue({
      teamId: opts.allowListed === false ? 'other-team' : TEAM,
    }),
  };
  const bookmarks = {
    find: jest.fn().mockResolvedValue(opts.saved.map((clipId) => ({ clipId }))),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn(() => ({
      insert: () => ({
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orIgnore: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(undefined),
      }),
    })),
  };
  const access = { isEnabledForTeam: (id?: string | null) => id === TEAM };
  const objectStorage = {
    createPresignedGetUrl: jest.fn().mockResolvedValue('https://signed'),
  };
  const service = new PublicFeedService(
    clips as never,
    players as never,
    {} as never,
    access as never,
    objectStorage as never,
    {} as never,
    bookmarks as never,
  );
  return { service, bookmarks };
}

describe('PublicFeedService.listSaved', () => {
  it('drops a saved clip that is no longer publicly visible', async () => {
    const { service } = build({
      saved: ['a', 'b', 'c'],
      stillVisible: ['a', 'c'],
    });

    const result = await service.listSaved(VIEWER);

    expect(result.items.map((i) => i.clipId)).toEqual(['a', 'c']);
  });

  it('counts what vanished without naming it', async () => {
    // Non-attributable on purpose: saying *which* clip went would let a
    // viewer track another child's un-publish decisions.
    const { service } = build({ saved: ['a', 'b', 'c'], stillVisible: ['a'] });

    const result = await service.listSaved(VIEWER);

    expect(result.missingCount).toBe(2);
    expect(JSON.stringify(result)).not.toContain('"b"');
  });

  it('keeps the order the viewer saved them in, not publication order', async () => {
    // This is a shelf, not a feed.
    const { service } = build({
      saved: ['c', 'a', 'b'],
      stillVisible: ['a', 'b', 'c'],
    });

    const result = await service.listSaved(VIEWER);

    expect(result.items.map((i) => i.clipId)).toEqual(['c', 'a', 'b']);
  });

  it('returns nothing at all when the team left the allow-list', async () => {
    // The whole surface is gone, so every saved row is missing in the
    // only sense the UI cares about — and no clip query runs.
    const { service } = build({
      saved: ['a', 'b'],
      stillVisible: ['a', 'b'],
      allowListed: false,
    });

    const result = await service.listSaved(VIEWER);

    expect(result.items).toEqual([]);
    expect(result.missingCount).toBe(2);
  });

  it('does not query at all when nothing is saved', async () => {
    const { service } = build({ saved: [], stillVisible: [] });

    await expect(service.listSaved(VIEWER)).resolves.toEqual({
      items: [],
      missingCount: 0,
    });
  });
});

describe('PublicFeedService bookmark writes', () => {
  it('refuses to save a clip the viewer cannot currently see', async () => {
    const { service, bookmarks } = build({ saved: [], stillVisible: [] });
    jest
      .spyOn(service, 'assertPubliclyVisibleTo')
      .mockRejectedValue(new ClipNotFoundException());

    await expect(service.saveBookmark(VIEWER, 'x')).rejects.toBeInstanceOf(
      ClipNotFoundException,
    );
    expect(bookmarks.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('lets a viewer un-save a clip that is already gone', async () => {
    // Same reasoning as withdrawing a reaction: never strand a row the
    // viewer asked to remove.
    const { service, bookmarks } = build({ saved: [], stillVisible: [] });
    const gate = jest.spyOn(service, 'assertPubliclyVisibleTo');

    await service.removeBookmark(VIEWER, 'gone');

    expect(gate).not.toHaveBeenCalled();
    expect(bookmarks.delete).toHaveBeenCalledWith({
      clipId: 'gone',
      playerId: VIEWER,
    });
  });
});
