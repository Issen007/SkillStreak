import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Dormant since Phase 2's kapten pivot: no CoachAuthGuard, no coach
// login/password, no coach-facing endpoint anywhere in this codebase reads
// or writes this table (see ADR-0004's 2026-07-05 addendum, which
// supersedes that ADR's original coach-password-auth design, and
// ADR-0005). The only writer is src/scripts/seed.ts, which still creates
// one Coach row + a TeamCoach link purely so the FK on that seed data is
// satisfiable — not because anything downstream consumes it. Kept (not
// dropped) because the table/FKs already exist in the schema and a
// coach-facing view is plausible again later; don't build new features
// against this entity without first checking whether coach auth is back
// on the roadmap.
@Entity('coach')
export class Coach {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  email!: string;

  @Column({ name: 'display_name', type: 'varchar' })
  displayName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
