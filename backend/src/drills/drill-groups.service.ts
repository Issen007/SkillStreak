import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  DrillGroupLimitException,
  DrillGroupNotFoundException,
  DrillNotInLibraryException,
} from '../common/errors/exceptions';
import { DrillLibraryService, DrillSummary } from './drill-library.service';
import {
  DRILL_GROUP_MAX_TAGS,
  DRILL_GROUP_TAG_MAX,
} from './dto/upsert-drill-group.dto';
import { DrillGroup, DrillGroupDrill } from './entities/drill-group.entity';

/** Generous enough that no real trainer meets it. */
export const DRILL_GROUP_MAX_PER_OWNER = 100;

export interface DrillGroupView {
  id: string;
  name: string;
  tags: string[];
  createdAt: string;
  /** Resolved against the live library, so a removed drill simply stops
   *  appearing rather than rendering as a dead slug. */
  drills: DrillSummary[];
}

@Injectable()
export class DrillGroupsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly drillLibraryService: DrillLibraryService,
    @InjectRepository(DrillGroup)
    private readonly groupRepository: Repository<DrillGroup>,
    @InjectRepository(DrillGroupDrill)
    private readonly membershipRepository: Repository<DrillGroupDrill>,
  ) {}

  /**
   * Trim, drop blanks, collapse inner whitespace, dedupe case-insensitively
   * while keeping the casing the trainer typed, and cap both the count and
   * each tag's length.
   *
   * Dedupe is case-insensitive because "Uppvärmning" and "uppvärmning" are
   * one label to the person who typed them, and a filter that treats them
   * as two is just broken. `localeCompare`-free on purpose: this compares
   * for identity, not sort order.
   */
  private normaliseTags(tags: string[] | undefined): string {
    if (!tags?.length) return '';
    const seen = new Set<string>();
    const kept: string[] = [];
    for (const raw of tags) {
      // Split on commas rather than sanitising them away. The column is
      // comma-joined, so a comma inside one tag would forge an extra tag
      // on read — but "teknik, skott" typed into one box means two tags,
      // not one tag with a space in it. The console splits client-side
      // too; doing it here as well means the console's split is a
      // convenience rather than the only thing making commas work.
      for (const piece of String(raw).split(',')) {
        if (kept.length >= DRILL_GROUP_MAX_TAGS) return kept.join(',');
        const tag = piece
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, DRILL_GROUP_TAG_MAX);
        if (!tag) continue;
        const key = tag.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        kept.push(tag);
      }
    }
    return kept.join(',');
  }

  private splitTags(stored: string): string[] {
    return stored ? stored.split(',').filter(Boolean) : [];
  }

  private toView(group: DrillGroup, slugs: string[]): DrillGroupView {
    const drills = slugs
      .map((slug) => this.drillLibraryService.findBySlug(slug))
      .filter((drill): drill is NonNullable<typeof drill> => Boolean(drill))
      // Fields listed rather than rest-spread off `body`, matching
      // DrillLibraryService.list: the listing's shape stays a written
      // decision instead of a side effect of which fields were omitted.
      .map((drill) => ({
        slug: drill.slug,
        title: drill.title,
        ageBand: drill.ageBand,
        focus: drill.focus,
        durationMinutes: drill.durationMinutes,
        locale: drill.locale,
        author: drill.author,
        sourceNote: drill.sourceNote,
      }));

    return {
      id: group.id,
      name: group.name,
      tags: this.splitTags(group.tags),
      createdAt: group.createdAt.toISOString(),
      drills,
    };
  }

  /** Every group this trainer owns, with membership resolved. One query
   *  for groups and one for all their memberships — not one per group. */
  async list(ownerStaffAccountId: string): Promise<DrillGroupView[]> {
    const groups = await this.groupRepository.find({
      where: { ownerStaffAccountId },
      order: { name: 'ASC' },
    });
    if (!groups.length) return [];

    const memberships = await this.membershipRepository.find({
      where: { groupId: In(groups.map((group) => group.id)) },
    });
    const byGroup = new Map<string, string[]>();
    for (const row of memberships) {
      const slugs = byGroup.get(row.groupId) ?? [];
      slugs.push(row.drillSlug);
      byGroup.set(row.groupId, slugs);
    }

    return groups.map((group) =>
      this.toView(group, byGroup.get(group.id) ?? []),
    );
  }

  async create(
    ownerStaffAccountId: string,
    input: { name: string; tags?: string[] },
  ): Promise<DrillGroupView> {
    const existing = await this.groupRepository.count({
      where: { ownerStaffAccountId },
    });
    if (existing >= DRILL_GROUP_MAX_PER_OWNER) {
      throw new DrillGroupLimitException(DRILL_GROUP_MAX_PER_OWNER);
    }

    const saved = await this.groupRepository.save(
      this.groupRepository.create({
        ownerStaffAccountId,
        name: input.name.trim(),
        tags: this.normaliseTags(input.tags),
      }),
    );
    return this.toView(saved, []);
  }

  async update(
    ownerStaffAccountId: string,
    groupId: string,
    input: { name: string; tags?: string[] },
  ): Promise<DrillGroupView> {
    const group = await this.findOwned(ownerStaffAccountId, groupId);
    group.name = input.name.trim();
    group.tags = this.normaliseTags(input.tags);
    await this.groupRepository.save(group);

    const memberships = await this.membershipRepository.find({
      where: { groupId },
    });
    return this.toView(
      group,
      memberships.map((row) => row.drillSlug),
    );
  }

  /** Memberships go with it via ON DELETE CASCADE. */
  async remove(ownerStaffAccountId: string, groupId: string): Promise<void> {
    await this.findOwned(ownerStaffAccountId, groupId);
    await this.groupRepository.delete({ id: groupId, ownerStaffAccountId });
  }

  /**
   * Set which of this trainer's groups a drill belongs to — the checkbox
   * list on a drill, saved in one action.
   *
   * Replace-not-merge, in a transaction: the caller sends the state it
   * wants, and unticking a box has to actually remove the row. Scoped to
   * the owner's own group ids on both sides, so an id belonging to another
   * trainer is neither written nor deleted.
   */
  async setGroupsForDrill(
    ownerStaffAccountId: string,
    slug: string,
    groupIds: string[],
  ): Promise<DrillGroupView[]> {
    if (!this.drillLibraryService.findBySlug(slug)) {
      throw new DrillNotInLibraryException();
    }

    const owned = await this.groupRepository.find({
      where: { ownerStaffAccountId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((group) => group.id));
    // An unknown id is dropped rather than throwing: this is a checkbox
    // list, and a group deleted in another tab shouldn't fail the save of
    // the ones that are still real.
    const target = [...new Set(groupIds)].filter((id) => ownedIds.has(id));

    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(DrillGroupDrill);
      if (ownedIds.size) {
        await repository.delete({
          drillSlug: slug,
          groupId: In([...ownedIds]),
        });
      }
      if (target.length) {
        await repository.insert(
          target.map((groupId) => ({ groupId, drillSlug: slug })),
        );
      }
    });

    return this.list(ownerStaffAccountId);
  }

  private async findOwned(
    ownerStaffAccountId: string,
    groupId: string,
  ): Promise<DrillGroup> {
    // A malformed id would make Postgres throw on the uuid cast rather
    // than return no rows, turning a typo into a 500.
    if (!/^[0-9a-f-]{36}$/i.test(groupId)) {
      throw new DrillGroupNotFoundException();
    }
    const group = await this.groupRepository.findOne({
      where: { id: groupId, ownerStaffAccountId },
    });
    if (!group) throw new DrillGroupNotFoundException();
    return group;
  }
}
