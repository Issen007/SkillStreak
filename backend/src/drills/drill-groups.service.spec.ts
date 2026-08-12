import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DrillLibraryService } from './drill-library.service';
import { DrillGroupsService } from './drill-groups.service';
import { DrillGroup, DrillGroupDrill } from './entities/drill-group.entity';
import {
  DrillGroupNotFoundException,
  DrillNotInLibraryException,
} from '../common/errors/exceptions';

const OWNER = '11111111-1111-1111-1111-111111111111';
const OTHER_OWNER = '22222222-2222-2222-2222-222222222222';
const GROUP_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const GROUP_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
/** Belongs to OTHER_OWNER — never returned by the owner-scoped queries. */
const FOREIGN_GROUP = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function group(id: string, name: string, tags = ''): DrillGroup {
  return {
    id,
    ownerStaffAccountId: OWNER,
    name,
    tags,
    createdAt: new Date('2026-08-12T09:00:00Z'),
  };
}

/** Typed reads of mock calls — this repo's lint rules reject `any`, and
 *  an untyped `.mock.calls[0][0]` is `any` all the way down. */
function savedGroup(mock: jest.Mock): DrillGroup {
  return (mock.mock.calls[0] as [DrillGroup])[0];
}

interface MembershipDeleteCriteria {
  drillSlug: string;
  /** TypeORM's In() operator; `.value` is the array it wraps. */
  groupId: { value: string[] };
}

function deleteCriteria(mock: jest.Mock): MembershipDeleteCriteria {
  return (mock.mock.calls[0] as [MembershipDeleteCriteria])[0];
}

interface InsertedMembership {
  groupId: string;
  drillSlug: string;
}

function insertedRows(mock: jest.Mock): InsertedMembership[] {
  return (mock.mock.calls[0] as [InsertedMembership[]])[0];
}

describe('DrillGroupsService', () => {
  let service: DrillGroupsService;
  let groupFind: jest.Mock;
  let groupFindOne: jest.Mock;
  let groupSave: jest.Mock;
  let groupCount: jest.Mock;
  let membershipFind: jest.Mock;
  let membershipDelete: jest.Mock;
  let membershipInsert: jest.Mock;

  beforeEach(async () => {
    groupFind = jest.fn().mockResolvedValue([]);
    groupFindOne = jest.fn().mockResolvedValue(null);
    groupSave = jest.fn().mockImplementation((entity: Partial<DrillGroup>) => ({
      id: GROUP_A,
      createdAt: new Date('2026-08-12T09:00:00Z'),
      ...entity,
    }));
    groupCount = jest.fn().mockResolvedValue(0);
    membershipFind = jest.fn().mockResolvedValue([]);
    membershipDelete = jest.fn().mockResolvedValue({ affected: 0 });
    membershipInsert = jest.fn().mockResolvedValue({ identifiers: [] });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DrillGroupsService,
        {
          provide: DataSource,
          useValue: {
            transaction: (callback: (manager: unknown) => unknown) =>
              callback({
                getRepository: () => ({
                  delete: membershipDelete,
                  insert: membershipInsert,
                }),
              }),
          },
        },
        {
          provide: DrillLibraryService,
          useValue: {
            findBySlug: (slug: string) =>
              slug === 'kortpassningar-under-press'
                ? {
                    slug,
                    title: 'Kortpassningar under press',
                    ageBand: '9-11',
                    focus: 'passning',
                    durationMinutes: 15,
                    locale: 'sv',
                    author: 'Anonym tränare',
                    sourceNote: null,
                    body: 'text',
                  }
                : undefined,
          },
        },
        {
          provide: getRepositoryToken(DrillGroup),
          useValue: {
            find: groupFind,
            findOne: groupFindOne,
            save: groupSave,
            count: groupCount,
            create: (input: unknown) => input,
            delete: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
        {
          provide: getRepositoryToken(DrillGroupDrill),
          useValue: { find: membershipFind },
        },
      ],
    }).compile();

    service = module.get(DrillGroupsService);
  });

  describe('tag normalisation', () => {
    it('splits a comma-separated string into separate tags', async () => {
      // The column is comma-joined, so a stored comma would forge an extra
      // tag on read anyway. "teknik, skott" typed into one box is two
      // tags, which is what the trainer meant — and matches what the
      // console sends after its own split.
      await service.create(OWNER, {
        name: 'Uppvärmning',
        tags: ['teknik, skott'],
      });
      expect(savedGroup(groupSave).tags).toBe('teknik,skott');
    });

    it('dedupes case-insensitively but keeps the typed casing', async () => {
      await service.create(OWNER, {
        name: 'Pass',
        tags: ['Uppvärmning', 'uppvärmning', '  UPPVÄRMNING  '],
      });
      expect(savedGroup(groupSave).tags).toBe('Uppvärmning');
    });

    it('drops blanks and caps the count at ten', async () => {
      await service.create(OWNER, {
        name: 'Many',
        tags: ['', '   ', ...Array.from({ length: 15 }, (_, i) => `tag${i}`)],
      });
      expect(savedGroup(groupSave).tags.split(',')).toHaveLength(10);
    });
  });

  describe('ownership scoping', () => {
    it('refuses a group the caller does not own', async () => {
      // findOne is owner-scoped, so another trainer's real id returns null
      // — indistinguishable from a made-up one, which is the point.
      groupFindOne.mockResolvedValue(null);
      await expect(
        service.update(OWNER, FOREIGN_GROUP, { name: 'Renamed' }),
      ).rejects.toBeInstanceOf(DrillGroupNotFoundException);
      expect(groupFindOne).toHaveBeenCalledWith({
        where: { id: FOREIGN_GROUP, ownerStaffAccountId: OWNER },
      });
    });

    it('rejects a malformed id without reaching Postgres', async () => {
      // An invalid uuid makes Postgres throw on the cast rather than
      // return no rows, which would turn a typo into a 500.
      await expect(service.remove(OWNER, 'not-a-uuid')).rejects.toBeInstanceOf(
        DrillGroupNotFoundException,
      );
      expect(groupFindOne).not.toHaveBeenCalled();
    });

    it('ignores foreign group ids when assigning a drill', async () => {
      // Full rows: setGroupsForDrill's ownership query selects only ids,
      // but it re-lists at the end through the same repository.
      groupFind.mockResolvedValue([group(GROUP_A, 'A'), group(GROUP_B, 'B')]);
      await service.setGroupsForDrill(OWNER, 'kortpassningar-under-press', [
        GROUP_A,
        FOREIGN_GROUP,
      ]);

      // Written: only the owned id. Not written: the foreign one — so a
      // trainer cannot push a drill into someone else's group.
      expect(insertedRows(membershipInsert)).toEqual([
        { groupId: GROUP_A, drillSlug: 'kortpassningar-under-press' },
      ]);
      // Deleted: scoped to the owner's own groups, so the replace-not-merge
      // write can never clear another trainer's membership rows.
      expect(deleteCriteria(membershipDelete).groupId.value).toEqual([
        GROUP_A,
        GROUP_B,
      ]);
    });

    it('rejects a slug the library does not carry', async () => {
      // Keeps drill_slug a repo-controlled vocabulary rather than a second
      // free-text column.
      await expect(
        service.setGroupsForDrill(OWNER, 'anything-at-all', [GROUP_A]),
      ).rejects.toBeInstanceOf(DrillNotInLibraryException);
    });
  });

  describe('reading', () => {
    it('drops membership rows whose drill has left the library', async () => {
      groupFind.mockResolvedValue([group(GROUP_A, 'Uppvärmning', 'teknik')]);
      membershipFind.mockResolvedValue([
        { groupId: GROUP_A, drillSlug: 'kortpassningar-under-press' },
        { groupId: GROUP_A, drillSlug: 'removed-last-week' },
      ]);

      const [view] = await service.list(OWNER);
      expect(view.drills.map((drill) => drill.slug)).toEqual([
        'kortpassningar-under-press',
      ]);
      expect(view.tags).toEqual(['teknik']);
    });

    it('never includes the drill body in a group listing', async () => {
      groupFind.mockResolvedValue([group(GROUP_A, 'Uppvärmning')]);
      membershipFind.mockResolvedValue([
        { groupId: GROUP_A, drillSlug: 'kortpassningar-under-press' },
      ]);

      const [view] = await service.list(OWNER);
      expect(view.drills[0]).not.toHaveProperty('body');
    });

    it('reads memberships in one query, not one per group', async () => {
      groupFind.mockResolvedValue([group(GROUP_A, 'A'), group(GROUP_B, 'B')]);
      await service.list(OWNER);
      expect(membershipFind).toHaveBeenCalledTimes(1);
    });

    it('returns nothing for an owner with no groups, without a second query', async () => {
      groupFind.mockResolvedValue([]);
      expect(await service.list(OTHER_OWNER)).toEqual([]);
      expect(membershipFind).not.toHaveBeenCalled();
    });
  });
});
