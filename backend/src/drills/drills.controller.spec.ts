import { DrillLibraryForbiddenException } from '../common/errors/exceptions';
import { StaffAccountRole } from '../staff-auth/entities/staff-account.entity';
import { DrillsController } from './drills.controller';

/**
 * The gate is the whole of ADR-0029 Decision 4, and until now it was one
 * line in a controller with no test — exactly the kind of check a
 * refactor drops silently. The ADR itself expects this check to move
 * inside ADR-0023 Part C's resolver later, which is precisely the move
 * that loses things.
 */
describe('DrillsController access gate', () => {
  function build(hasLink: boolean) {
    const drillLibraryService = {
      list: jest.fn().mockReturnValue([{ slug: 'a' }]),
      findBySlug: jest.fn().mockReturnValue({ slug: 'a', body: 'x' }),
    };
    const ptTeamLinksService = {
      hasAnyActiveLink: jest.fn().mockResolvedValue(hasLink),
    };
    const controller = new DrillsController(
      drillLibraryService as never,
      ptTeamLinksService as never,
    );
    return { controller, drillLibraryService, ptTeamLinksService };
  }

  it('refuses a trainer holding no active team link', async () => {
    const { controller } = build(false);

    await expect(
      controller.list('staff-1', StaffAccountRole.PT),
    ).rejects.toBeInstanceOf(DrillLibraryForbiddenException);
  });

  it('does not consult the library before the gate passes', async () => {
    const { controller, drillLibraryService } = build(false);

    await expect(
      controller.list('staff-1', StaffAccountRole.PT),
    ).rejects.toBeInstanceOf(DrillLibraryForbiddenException);
    expect(drillLibraryService.list).not.toHaveBeenCalled();
  });

  it('gates the detail route too, not only the listing', async () => {
    const { controller, drillLibraryService } = build(false);

    await expect(
      controller.findOne('staff-1', StaffAccountRole.PT, 'a'),
    ).rejects.toBeInstanceOf(DrillLibraryForbiddenException);
    expect(drillLibraryService.findBySlug).not.toHaveBeenCalled();
  });

  it('lets a trainer with an active link read', async () => {
    const { controller } = build(true);

    await expect(
      controller.list('staff-1', StaffAccountRole.PT),
    ).resolves.toHaveLength(1);
  });

  it('lets an admin read without any team link', async () => {
    // The project owner's normal state. Missing this branch was a live
    // broken tab, found by the security review.
    const { controller, ptTeamLinksService } = build(false);

    await expect(
      controller.list('staff-1', StaffAccountRole.ADMIN),
    ).resolves.toHaveLength(1);
    // Short-circuits: an admin is not asked about team links at all.
    expect(ptTeamLinksService.hasAnyActiveLink).not.toHaveBeenCalled();
  });
});
