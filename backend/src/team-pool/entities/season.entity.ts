import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

// The team pool resets/tracks per season (a month or a full säsong) — see
// docs/adr/0002-data-model.md. Still seed-only as of Phase 2 (see
// src/scripts/seed.ts): the coach-facing season/pot management endpoints
// once planned for "Phase 2" never got built — Phase 2 pivoted to the
// kapten/weekly-goal model instead (ADR-0005) and added no season-rollover
// UI. Creating/rotating a Season or TeamSeasonPot is still a manual/seed
// action; season rollover remains an open gap tracked in
// docs/ACTION_PLAN.md's Phase 1 follow-ups.
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
