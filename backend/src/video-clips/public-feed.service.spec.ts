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
