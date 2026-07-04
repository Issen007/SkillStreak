import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

// The team pool resets/tracks per season (a month or a full säsong) — see
// docs/adr/0002-data-model.md. Season/TeamSeasonPot management endpoints
// (coach-facing) are Phase 2; Phase 1 relies on a seeded Season +
// TeamSeasonPot (see src/scripts/seed.ts).
@Entity('season')
export class Season {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'team_id', type: 'uuid' })
  teamId!: string;

  @Column({ type: 'varchar' })
  label!: string;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate!: string;
}
