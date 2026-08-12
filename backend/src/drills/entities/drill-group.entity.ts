import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A trainer's own grouping of drills from the library.
 *
 * **Private to its owner.** ADR-0029's cross-team surface is the library
 * itself, which is operator-curated and reviewed as a git diff. A group is
 * one adult organising public material for their own use, so it needs no
 * cross-team visibility decision and gets none — every query in
 * DrillGroupsService is scoped to `ownerStaffAccountId`.
 *
 * No player, no team, no clip. The drill library has no table to join to a
 * child (DrillLibraryService's whole point), and this does not add one.
 */
@Entity('drill_group')
@Index('IDX_drill_group_owner', ['ownerStaffAccountId', 'name'])
export class DrillGroup {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'owner_staff_account_id', type: 'uuid' })
  ownerStaffAccountId!: string;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  /**
   * Comma-separated, normalised on write (see DrillGroupsService.normaliseTags).
   *
   * A join table for a handful of private labels on a handful of private
   * groups would be three queries where one does, and nothing ever needs
   * to ask "which groups carry tag X" across owners.
   *
   * **This is the only free-text column in the feature**, and the only
   * place a trainer could type something about a person. It is owner-
   * private and adult-authored, which is why it is acceptable here and
   * would not be if groups were shared — recorded in the migration and
   * flagged for the ADR-0029 follow-up review rather than left implicit.
   */
  @Column({ type: 'text', default: '' })
  tags!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * Membership. Referenced by drill SLUG because the library is files, not
 * rows — see the migration.
 *
 * The service rejects any slug the library doesn't currently carry, so
 * this column holds a value from a known, repo-controlled vocabulary
 * rather than arbitrary caller text. That keeps it from quietly becoming
 * a second free-text field.
 */
@Entity('drill_group_drill')
export class DrillGroupDrill {
  @PrimaryColumn({ name: 'group_id', type: 'uuid' })
  groupId!: string;

  @PrimaryColumn({ name: 'drill_slug', type: 'varchar', length: 120 })
  drillSlug!: string;
}
