import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// A Team is only ever reachable via its invite_code — no public listing/
// searchability, satisfying CLAUDE.md's "closed team bubbles" constraint
// structurally rather than via a visibility flag. Per docs/adr/0002 and
// docs/api/phase1-contract.md, Phase 1 has no coach self-serve team
// creation endpoint — teams are seeded (see src/scripts/seed.ts).
@Entity('team')
export class Team {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ name: 'invite_code', type: 'varchar', unique: true })
  inviteCode!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
