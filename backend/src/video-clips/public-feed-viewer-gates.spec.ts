import { Repository } from 'typeorm';
import {
  ConsentRequiredException,
  TeamJoinApprovalRequiredException,
} from '../common/errors/exceptions';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { TeamJoinStatus } from '../players/team-join-status.enum';
import { PublicFeedService } from './public-feed.service';
import { VideoClip } from './entities/video-clip.entity';

/**
 * The VIEWER's own two gates on the public feed — parental consent and
 * captain approval — added 2026-09-24.
 *
 * **Why this file exists.** Every other media surface in this app checks
 * both before showing a child anything: the team feed
 * (video-clips.service.ts), chat clip embeds (team-chat.service.ts), and
 * upload. The public feed — the one surface where a clip leaves the team
 * bubble, and therefore the one with the widest audience — checked
 * neither. It resolved the viewer's row selecting `teamId` alone, so the
 * consent status was not merely unchecked, it was never loaded.
 *
 * A brand-new account (parental consent PENDING, team-join PENDING, both
 * of which are the defaults in players.service.ts) that joined an
 * allow-listed team with an invite code could read other children's
 * video. That is the 2026-08-17 chat-embed incident's exact shape.
 *
 * Every test here fails if either gate is removed. The bug was invisible
 * for the same reason the gate-5 bug was: nothing asserted the absence.
 */

const TEAM = 'team-1';
const VIEWER = 'viewer-1';
const CLIP = '11111111-1111-4111-8111-111111111111';
const openAccess = { isEnabledForTeam: (id?: string | null) => id === TEAM };

function buildService(viewer: {
  consent?: ParentalConsentStatus;
  join?: TeamJoinStatus;
  teamId?: string;
}) {
  const qb: Record<string, unknown> = {};
  for (const m of [
    'innerJoin',
    'select',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'limit',
  ]) {
    qb[m] = jest.fn(() => qb);
  }
  // A row that WOULD be returned if the query ran — so a test that sees
  // an empty result is seeing the viewer gate, not an empty fixture.
  qb.getRawMany = jest.fn(() => Promise.resolve([]));
  qb.getRawOne = jest.fn(() =>
    Promise.resolve({ uploaderPlayerId: 'uploader-1' }),
  );

  const clips = { createQueryBuilder: jest.fn(() => qb) };
  const players = {
    findOne: jest.fn().mockResolvedValue({
      teamId: viewer.teamId ?? TEAM,
      parentalConsentStatus: viewer.consent ?? ParentalConsentStatus.APPROVED,
      teamJoinStatus: viewer.join ?? TeamJoinStatus.APPROVED,
    }),
  };
  const bookmarks = {
    find: jest.fn().mockResolvedValue([{ clipId: CLIP }]),
  };

  const service = new PublicFeedService(
    clips as unknown as Repository<VideoClip>,
    players as never,
    undefined as never, // consentService — not reached by these paths
    openAccess as never,
    undefined as never, // objectStorage — no URL is minted in these tests
    undefined as never, // reports
    bookmarks as never,
  );
  return { service, clips, players, qb };
}

describe('public feed — the viewer must be consented and admitted', () => {
  describe('list()', () => {
    it('serves an approved, admitted viewer', async () => {
      const { service, clips } = buildService({});
      await service.list(VIEWER);
      // The query ran at all — the gate let this viewer through.
      expect(clips.createQueryBuilder).toHaveBeenCalled();
    });

    it.each([
      ['pending parental consent', { consent: ParentalConsentStatus.PENDING }],
      ['revoked parental consent', { consent: ParentalConsentStatus.REVOKED }],
      ['a pending team join', { join: TeamJoinStatus.PENDING }],
      ['a rejected team join', { join: TeamJoinStatus.REJECTED }],
      // The exact account the exploit used: brand new, both PENDING.
      [
        'a brand-new account, both pending',
        {
          consent: ParentalConsentStatus.PENDING,
          join: TeamJoinStatus.PENDING,
        },
      ],
    ])('returns nothing to a viewer with %s', async (_label, viewer) => {
      const { service, clips } = buildService(viewer);

      const page = await service.list(VIEWER);

      expect(page).toEqual({ items: [], nextCursor: null });
      // Never even builds the query: the clips table is not read for an
      // account that may not see clips.
      expect(clips.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('listSaved()', () => {
    it('empties the shelf for an unconsented viewer rather than serving it', async () => {
      const { service, clips } = buildService({
        consent: ParentalConsentStatus.PENDING,
      });

      const result = await service.listSaved(VIEWER);

      // The saved rows still count as "missing" so the UI can say
      // something vanished — it just never gets a playback URL.
      expect(result.items).toEqual([]);
      expect(result.missingCount).toBe(1);
      expect(clips.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('assertPubliclyVisibleTo() — save, react, report', () => {
    it('allows an approved, admitted viewer', async () => {
      const { service } = buildService({});
      await expect(
        service.assertPubliclyVisibleTo(VIEWER, CLIP),
      ).resolves.toEqual({ uploaderPlayerId: 'uploader-1' });
    });

    // Writes refuse loudly rather than degrading, unlike the read paths:
    // silently dropping an action the caller asked for is worse than
    // refusing it.
    it('refuses a viewer whose parent has not approved', async () => {
      const { service } = buildService({
        consent: ParentalConsentStatus.PENDING,
      });
      await expect(
        service.assertPubliclyVisibleTo(VIEWER, CLIP),
      ).rejects.toBeInstanceOf(ConsentRequiredException);
    });

    it('refuses a viewer no captain has admitted', async () => {
      const { service } = buildService({ join: TeamJoinStatus.PENDING });
      await expect(
        service.assertPubliclyVisibleTo(VIEWER, CLIP),
      ).rejects.toBeInstanceOf(TeamJoinApprovalRequiredException);
    });
  });
});
