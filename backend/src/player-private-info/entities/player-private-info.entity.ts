import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

// Per docs/adr/0002-data-model.md's 2026-07-03 addendum §1: real_name and
// parent_contact live here, structurally isolated from Player, so an
// ordinary query against Player (leaderboard, feed, badge lookups, a
// careless future `SELECT *`) cannot return this data. Only
// PlayerPrivateInfoModule may import this entity/repository — see that
// module's file for the enforced boundary.
@Entity('player_private_info')
export class PlayerPrivateInfo {
  // One-to-one with Player via a shared primary key (player_id), not a
  // surrogate id — there is exactly one private-info row per player, ever.
  @PrimaryColumn({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  // Optional — some teams/parents will prefer not to store it at all.
  @Column({ name: 'real_name', type: 'varchar', nullable: true })
  realName!: string | null;

  // Required — needed to run the consent flow (who do we ask for approval).
  @Column({ name: 'parent_contact', type: 'varchar' })
  parentContact!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
