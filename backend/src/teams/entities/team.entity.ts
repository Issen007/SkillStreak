import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// A Team is only ever reachable via its invite_code — no public listing/
// searchability, satisfying CLAUDE.md's "closed team bubbles" constraint
// structurally rather than via a visibility flag. Most teams are still
// seeded (see src/scripts/seed.ts) — there is still no *coach* self-serve
// team/invite-code creation endpoint. But per
// docs/adr/0009-self-service-team-creation.md, a player onboarding with an
// invite code that matches nothing can now create a team themselves
// (TeamsService.createTeam, the single entry point for a new Team row,
// called from OnboardingService.createPlayer's transaction), becoming its
// first player and automatic captain.
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
