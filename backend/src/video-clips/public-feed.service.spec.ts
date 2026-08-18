import { Repository } from 'typeorm';
import { VideoClip, VideoClipStatus } from './entities/video-clip.entity';
import {
  PUBLIC_FEED_PAGE_SIZE,
  PublicFeedService,
} from './public-feed.service';

/**
 * The four gates and the pagination contract.
 *
 * These assert the SQL the query builder produces rather than running it,
 * because what matters here is that each gate is *present and joined the
 * right way* — an INNER JOIN on consent versus a LEFT JOIN is the whole
 * difference between "revoking consent empties the feed instantly" and
 * "revoking consent does nothing until someone runs a sweep". Behaviour
 * against real rows belongs in the e2e suite.
 */
// The rollout allow-list (PublicSharingAccessService). These tests are
// about the four gates and the publish/unpublish rules, so the allow-list
// is stubbed open — the gate itself has its own tests. `TEAM` is the team
// every fixture clip and viewer belongs to.
const TEAM = 'team-1';
const openAccess = { isEnabledForTeam: (id?: string | null) => id === TEAM };
const viewerRepo = {
  findOne: jest.fn().mockResolvedValue({ teamId: TEAM }),
};

function buildService() {
  const captured: { sql?: string; params?: Record<string, unknown> } = {};
  const qb: Record<string, unknown> = {};
  const chain = (name: string) =>
    jest.fn((...args: unknown[]) => {
      if (name === 'where' || name === 'andWhere') {
        captured.sql = `${captured.sql ?? ''} ${String(args[0])}`;
        Object.assign(captured, {
          params: {
            ...(captured.params ?? {}),
            ...((args[1] as object) ?? {}),
          },
        });
      }
      if (name === 'innerJoin') {
        captured.sql = `${captured.sql ?? ''} INNERJOIN(${args
          .map(String)
          .join(',')})`;
      }
      if (name === 'orderBy' || name === 'addOrderBy') {
        captured.sql = `${captured.sql ?? ''} ORDER(${args.map(String).join(',')})`;
      }
      if (name === 'limit')
        captured.params = { ...captured.params, limit: args[0] };
      return qb;
    });
  for (const m of [
    'innerJoin',
    'select',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'limit',
  ]) {
    qb[m] = chain(m);
  }
  qb.getRawMany = jest.fn(() => Promise.resolve([]));

  const clips = { createQueryBuilder: jest.fn(() => qb) };
  const service = new PublicFeedService(
    clips as unknown as Repository<VideoClip>,
    viewerRepo as never,
    undefined as never,
    openAccess as never,
  );
  return { service, captured, qb };
}

describe('PublicFeedService: the four gates', () => {
  it('requires the child to have published the clip', async () => {
    const { service, captured } = buildService();
    await service.list('viewer-1');

    expect(captured.sql).toContain('clip.published_publicly_at IS NOT NULL');
  });

  it('joins the parent consent as an INNER JOIN on active', async () => {
    // The load-bearing gate. A LEFT JOIN, or copying consent onto the
    // clip row, would mean revocation leaves clips visible until some
    // sweep catches up — and ADR-0030 Decision 2 requires un-publish to
    // be immediate and unconditional.
    const { service, captured } = buildService();
    await service.list('viewer-1');

    expect(captured.sql).toContain('INNERJOIN(public_sharing_consent');
    expect(captured.sql).toContain("psc.status = 'active'");
    expect(captured.sql).toContain('psc.player_id = clip.uploader_player_id');
  });

  it('excludes clips that are no longer published at all', async () => {
    // A team-reported (hidden) clip must not remain visible to strangers
    // after vanishing for the people who know the child in person.
    const { service, captured } = buildService();
    await service.list('viewer-1');

    expect(captured.sql).toContain('clip.status = :published');
    expect(captured.params?.published).toBe(VideoClipStatus.PUBLISHED);
  });

  it('applies the viewer block, scoped to the viewer', async () => {
    const { service, captured } = buildService();
    await service.list('viewer-1');

    expect(captured.sql).toContain('team_chat_block');
    expect(captured.sql).toContain('b.blocker_player_id = :viewerId');
    expect(captured.params?.viewerId).toBe('viewer-1');
  });
});

describe('PublicFeedService: what a viewer is never told', () => {
  it('selects no team and never resolves a tagged player', async () => {
    // ADR-0019 Decision 3. Naming a stranger's team is how an online
    // contact becomes a physical one.
    const { service, qb } = buildService();
    await service.list('viewer-1');

    const selectMock = qb.select as jest.Mock<unknown, [string[]]>;
    const selected: string[] = selectMock.mock.calls[0][0];
    const joined = selected.join(' ');
    expect(joined).not.toMatch(/team/i);
    expect(joined).not.toMatch(/tagged/i);
    expect(joined).not.toMatch(/real_name/i);
  });
});

describe('PublicFeedService: pagination', () => {
  it('orders by the exact keyset tuple', async () => {
    const { service, captured } = buildService();
    await service.list('viewer-1');

    expect(captured.sql).toContain('ORDER(clip.published_publicly_at,DESC)');
    expect(captured.sql).toContain('ORDER(clip.id,DESC)');
  });

  it('fetches one extra row rather than counting', async () => {
    const { service, captured } = buildService();
    await service.list('viewer-1');

    expect(captured.params?.limit).toBe(PUBLIC_FEED_PAGE_SIZE + 1);
  });

  it('compares the whole tuple when a cursor is supplied', async () => {
    // Comparing the timestamp alone would drop every clip sharing a
    // millisecond with the previous page's last row.
    const { service, captured } = buildService();
    const cursor = Buffer.from(`2026-08-18T10:00:00.000Z|clip-9`).toString(
      'base64url',
    );

    await service.list('viewer-1', cursor);

    expect(captured.sql).toContain(
      '(clip.published_publicly_at, clip.id) < (:cursorAt, :cursorId)',
    );
    expect(captured.params?.cursorId).toBe('clip-9');
  });

  it('treats a malformed cursor as the first page, not an error', async () => {
    const { service, captured } = buildService();

    await service.list('viewer-1', 'not-a-real-cursor');

    expect(captured.sql).not.toContain(':cursorAt');
  });

  it('caps an oversized page request', async () => {
    const { service, captured } = buildService();
    await service.list('viewer-1', undefined, 10_000);

    expect(captured.params?.limit).toBe(51);
  });
});

/**
 * Publish and un-publish.
 *
 * The asymmetry between them is the design, not an oversight: publishing
 * is gated on a live parental consent, un-publishing is gated on nothing
 * at all. ADR-0019 Decision 5 requires un-publish to be "immediate and
 * unconditional, exactly matching self-delete's existing guarantee".
 */
function buildWrites(overrides: Record<string, unknown> = {}) {
  const clip = {
    id: '11111111-1111-4111-8111-111111111111',
    uploaderPlayerId: 'player-1',
    // The rollout allow-list gates on the clip's own team, so the fixture
    // has to belong to one — an undefined teamId is (correctly) refused.
    teamId: TEAM,
    status: VideoClipStatus.PUBLISHED,
    publishedPubliclyAt: null,
    ...overrides,
  } as unknown as VideoClip;

  const clips = {
    findOne: jest.fn(() => Promise.resolve(clip)),
    update: jest.fn(() => Promise.resolve({ affected: 1 })),
    createQueryBuilder: jest.fn(),
  };
  const consentService = {
    isActiveFor: jest.fn(() => Promise.resolve(true)),
  };
  const service = new PublicFeedService(
    clips as unknown as Repository<VideoClip>,
    viewerRepo as never,
    consentService as never,
    openAccess as never,
  );
  return { service, clips, consentService, clip };
}

describe('PublicFeedService.publish', () => {
  it('publishes the uploader’s own clip when consent is active', async () => {
    const { service, clips, clip } = buildWrites();

    const result = await service.publish('player-1', clip.id);

    expect(result).toEqual({ clipId: clip.id, publishedPublicly: true });
    expect(clips.update).toHaveBeenCalledWith(
      { id: clip.id, uploaderPlayerId: 'player-1' },
      { publishedPubliclyAt: expect.any(Date) as Date },
    );
  });

  it('refuses when the parent’s consent is not active', async () => {
    const { service, clips, consentService, clip } = buildWrites();
    consentService.isActiveFor.mockResolvedValue(false);

    await expect(service.publish('player-1', clip.id)).rejects.toThrow(
      /sharing outside the team is turned off/i,
    );
    expect(clips.update).not.toHaveBeenCalled();
  });

  it('re-reads consent rather than trusting an earlier check', async () => {
    // A parent who revoked yesterday must not have a clip published under
    // their name today because a session cached a `true`.
    const { service, consentService, clip } = buildWrites();
    await service.publish('player-1', clip.id);

    expect(consentService.isActiveFor).toHaveBeenCalledWith('player-1');
  });

  it('refuses another child’s clip', async () => {
    // "The player's own clips, never another child's" — the first thing
    // CLAUDE.md's amended closed-bubble rule promises.
    const { service, clips, clip } = buildWrites({
      uploaderPlayerId: 'someone-else',
    });

    await expect(service.publish('player-1', clip.id)).rejects.toThrow(
      /only the uploader/i,
    );
    expect(clips.update).not.toHaveBeenCalled();
  });

  it('refuses a clip that is no longer published to its team', async () => {
    const { service, clips, clip } = buildWrites({
      status: VideoClipStatus.HIDDEN,
    });

    await expect(service.publish('player-1', clip.id)).rejects.toThrow();
    expect(clips.update).not.toHaveBeenCalled();
  });

  it('does not bump an already-public clip back to the top', async () => {
    // Otherwise re-publishing is a free way to farm the feed's ordering.
    const { service, clips, clip } = buildWrites({
      publishedPubliclyAt: new Date('2026-08-01T00:00:00Z'),
    });

    await service.publish('player-1', clip.id);

    expect(clips.update).not.toHaveBeenCalled();
  });
});

describe('PublicFeedService.unpublish', () => {
  it('un-publishes without consulting consent at all', async () => {
    // The case where a parent has just revoked is the case where getting
    // a clip out fastest matters most. A child locked out of
    // un-publishing by the same event that should have removed the clip
    // would be the worst failure this design has.
    const { service, clips, consentService, clip } = buildWrites({
      publishedPubliclyAt: new Date(),
    });
    consentService.isActiveFor.mockResolvedValue(false);

    const result = await service.unpublish('player-1', clip.id);

    expect(result).toEqual({ clipId: clip.id, publishedPublicly: false });
    expect(consentService.isActiveFor).not.toHaveBeenCalled();
    expect(clips.update).toHaveBeenCalledWith(
      { id: clip.id, uploaderPlayerId: 'player-1' },
      { publishedPubliclyAt: null },
    );
  });

  it('works on a clip that is hidden or reported', async () => {
    // "even with open reports, right now, no exceptions".
    const { service, clips, clip } = buildWrites({
      status: VideoClipStatus.HIDDEN,
      publishedPubliclyAt: new Date(),
    });

    await expect(service.unpublish('player-1', clip.id)).resolves.toEqual({
      clipId: clip.id,
      publishedPublicly: false,
    });
    expect(clips.update).toHaveBeenCalled();
  });

  it('still refuses another child’s clip', async () => {
    const { service, clip } = buildWrites({ uploaderPlayerId: 'someone-else' });

    await expect(service.unpublish('player-1', clip.id)).rejects.toThrow(
      /only the uploader/i,
    );
  });

  it('is idempotent on a clip that was never public', async () => {
    const { service, clips, clip } = buildWrites();

    await expect(service.unpublish('player-1', clip.id)).resolves.toBeTruthy();
    expect(clips.update).not.toHaveBeenCalled();
  });
});
