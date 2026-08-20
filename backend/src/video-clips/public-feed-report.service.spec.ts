import { ClipNotFoundException } from '../common/errors/exceptions';
import { ClipReportReason } from './entities/clip-report.entity';
import { PublicFeedService } from './public-feed.service';

/**
 * Screen F3 — what reporting a stranger's public clip is allowed to do,
 * and more importantly what it must not.
 *
 * The rule worth pinning is the asymmetry in ADR-0019 Decision 4: a
 * report takes the clip **off the public feed** and does nothing else. A
 * stranger has standing to say "this should not be out here" and none at
 * all to reach into another team's bubble and remove something from the
 * people who already had it. A future change that also set `status` to
 * hidden would look like a stricter, safer version of this and would in
 * fact be a stranger deleting a child's clip from their own team.
 */

const VIEWER = 'viewer-1';
const CLIP = 'clip-1';
const UPLOADER = 'uploader-1';

function build() {
  const insert = {
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(undefined),
  };
  const clips = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
  const reports = {
    createQueryBuilder: jest.fn(() => ({ insert: () => insert })),
  };
  const service = new PublicFeedService(
    clips as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    reports as never,
  );
  jest
    .spyOn(service, 'assertPubliclyVisibleTo')
    .mockResolvedValue({ uploaderPlayerId: UPLOADER });
  return { service, clips, insert };
}

describe('PublicFeedService.reportPublicClip', () => {
  it('un-publishes the clip', async () => {
    const { service, clips } = build();

    await service.reportPublicClip(
      VIEWER,
      CLIP,
      ClipReportReason.INAPPROPRIATE_CONTENT,
    );

    expect(clips.update).toHaveBeenCalledWith(
      { id: CLIP },
      { publishedPubliclyAt: null },
    );
  });

  it('does NOT hide the clip from its own team', async () => {
    // The asymmetry this whole file exists for. `status` must not appear
    // in the update at all — a stranger's report ends public visibility,
    // never the team's access to their own teammate's clip.
    const { service, clips } = build();

    await service.reportPublicClip(VIEWER, CLIP, ClipReportReason.BULLYING);

    const calls = clips.update.mock.calls as unknown as Array<
      [unknown, Record<string, unknown>]
    >;
    const patch = calls[0][1];
    expect(Object.keys(patch)).toEqual(['publishedPubliclyAt']);
    expect(patch).not.toHaveProperty('status');
  });

  it('records who was reported, so triage is not a lookup', async () => {
    const { service, insert } = build();

    await service.reportPublicClip(
      VIEWER,
      CLIP,
      ClipReportReason.APPEARS_WITHOUT_CONSENT,
    );

    expect(insert.values).toHaveBeenCalledWith({
      clipId: CLIP,
      reporterPlayerId: VIEWER,
      reportedUploaderPlayerId: UPLOADER,
      reason: ClipReportReason.APPEARS_WITHOUT_CONSENT,
    });
  });

  it('accepts a repeat report silently rather than erroring', async () => {
    // One report per viewer per clip — an accusation must not be
    // inflatable. But erroring on the repeat makes the safest button in
    // the app feel broken to a child who taps it twice.
    const { service, insert } = build();

    await service.reportPublicClip(VIEWER, CLIP, ClipReportReason.OTHER);

    expect(insert.orIgnore).toHaveBeenCalled();
  });

  it('refuses a clip that is not publicly visible, and changes nothing', async () => {
    const { service, clips, insert } = build();
    jest
      .spyOn(service, 'assertPubliclyVisibleTo')
      .mockRejectedValue(new ClipNotFoundException());

    await expect(
      service.reportPublicClip(VIEWER, CLIP, ClipReportReason.OTHER),
    ).rejects.toBeInstanceOf(ClipNotFoundException);
    expect(insert.execute).not.toHaveBeenCalled();
    expect(clips.update).not.toHaveBeenCalled();
  });
});
