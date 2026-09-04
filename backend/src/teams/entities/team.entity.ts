import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Jurisdiction } from '../../common/age/article8-age';

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

  /**
   * Which country's GDPR Article 8 age applies to this team's players.
   *
   * On the TEAM rather than the player, because it is a fact about a
   * floorball club — the thing that actually sits in a country — and
   * because one value per ~15 children is a far better question than
   * asking each child where they live. It is also not a child's
   * location: it does not narrow past a national border, it says nothing
   * about where anyone trains, and CLAUDE.md's no-location-tracking
   * constraint is about the latter.
   *
   * **Nullable, and null means the strictest age**, not Sweden's. A team
   * whose country nobody has stated yet asks every player for a parent,
   * whatever their age — see `article8AgeFor`. Failing toward more
   * protection is the same posture ADR-0030 Decision 11 takes with the
   * sharing allow-list, where empty means nobody.
   */
  @Column({
    name: 'jurisdiction',
    type: 'varchar',
    length: 2,
    nullable: true,
  })
  jurisdiction!: Jurisdiction | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
