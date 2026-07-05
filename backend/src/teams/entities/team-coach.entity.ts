import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Many-to-many join between Coach and Team (assistant coaches / multiple
// teams per coach are plausible even in Fas 1, per ADR-0002). No FK
// decorators/relations wired to Coach/Team entities here on purpose — no
// coach-facing endpoints exist that need to traverse this relationship, so
// we keep it to the plain columns + FK constraint the migration
// establishes, avoiding speculative relation wiring nothing consumes yet.
// Dormant since Phase 2's kapten pivot, same as Coach itself (see that
// entity's comment) — only src/scripts/seed.ts writes here.
@Entity('team_coach')
@Index(['teamId', 'coachId'], { unique: true })
export class TeamCoach {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'team_id', type: 'uuid' })
  teamId!: string;

  @Column({ name: 'coach_id', type: 'uuid' })
  coachId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
