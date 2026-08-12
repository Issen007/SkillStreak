import { DrillLibraryForbiddenException } from '../common/errors/exceptions';
import { StaffAccountRole } from '../staff-auth/entities/staff-account.entity';
import { DrillAccessService } from './drill-access.service';
import { DrillGroupsController } from './drill-groups.controller';
import { DrillsController } from './drills.controller';

/**
 * The gate is the whole of ADR-0029 Decision 4, and until now it was one
 * line in a controller with no test — exactly the kind of check a
 * refactor drops silently. The ADR itself expects this check to move
 * inside ADR-0023 Part C's resolver later, which is precisely the move
 * that loses things.
 *
 * That move has now happened once, onto DrillAccessService, so these
 * build a REAL DrillAccessService over a mock PtTeamLinksService rather
 * than stubbing the gate out. A test that mocked `assertMayRead` would
 * pass just as happily if the gate stopped refusing anyone.
 */
describe('drill library access gate', () => {
  function build(hasLink: boolean) {
    const drillLibraryService = {
      list: jest.fn().mockReturnValue([{ slug: 'a' }]),
      findBySlug: jest.fn().mockReturnValue({ slug: 'a', body: 'x' }),
    };
    const drillGroupsService = {
      list: jest.fn().mockResolvedValue([{ id: 'g1' }]),
      create: jest.fn().mockResolvedValue({ id: 'g1' }),
      remove: jest.fn().mockResolvedValue(undefined),
      setGroupsForDrill: jest.fn().mockResolvedValue([]),
    };
    const ptTeamLinksService = {
      hasAnyActiveLink: jest.fn().mockResolvedValue(hasLink),
    };
    const accessService = new DrillAccessService(ptTeamLinksService as never);
    return {
      controller: new DrillsController(
        drillLibraryService as never,
        accessService,
      ),
      groupsController: new DrillGroupsController(
        drillGroupsService as never,
        accessService,
      ),
      drillLibraryService,
      drillGroupsService,
      ptTeamLinksService,
    };
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

  // Groups are a second surface over the same material and reached the
  // same gate by a different route. Listing the routes explicitly means a
  // new one added without the gate fails here rather than shipping open.
  describe('groups routes are behind the same gate', () => {
    it('refuses every write route to an ungated trainer', async () => {
      const { groupsController, drillGroupsService } = build(false);

      await expect(
        groupsController.list('staff-1', StaffAccountRole.PT),
      ).rejects.toBeInstanceOf(DrillLibraryForbiddenException);
      await expect(
        groupsController.create('staff-1', StaffAccountRole.PT, {
          name: 'Uppvärmning',
        }),
      ).rejects.toBeInstanceOf(DrillLibraryForbiddenException);
      await expect(
        groupsController.remove('staff-1', StaffAccountRole.PT, 'g1'),
      ).rejects.toBeInstanceOf(DrillLibraryForbiddenException);
      await expect(
        groupsController.setGroupsForDrill('staff-1', StaffAccountRole.PT, {
          slug: 'a',
          groupIds: ['g1'],
        }),
      ).rejects.toBeInstanceOf(DrillLibraryForbiddenException);

      expect(drillGroupsService.list).not.toHaveBeenCalled();
      expect(drillGroupsService.create).not.toHaveBeenCalled();
      expect(drillGroupsService.remove).not.toHaveBeenCalled();
      expect(drillGroupsService.setGroupsForDrill).not.toHaveBeenCalled();
    });

    it('passes the caller own id to the service, never a caller-supplied one', async () => {
      // Every group route is scoped in the service by this argument. If a
      // route ever took an owner id from the body instead, this is where
      // it would show up.
      const { groupsController, drillGroupsService } = build(true);

      await groupsController.list('staff-1', StaffAccountRole.PT);
      expect(drillGroupsService.list).toHaveBeenCalledWith('staff-1');
    });
  });
});
