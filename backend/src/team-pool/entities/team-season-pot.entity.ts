import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { TeamSeasonPotStatus } from '../team-season-pot-status.enum';

// Postgres is the authoritative store for points_total (ADR-0002); Redis
// holds a live-gauge cache for fast reads (see RedisService). Updated via
// an atomic increment (see TeamPoolService.addPoints), not read-modify-
// write, to stay correct under concurrent training-log writes from
// different players on the same team.
@Entity('team_season_pot')
@Index(['teamId', 'status'])
export class TeamSeasonPot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'team_id', type: 'uuid' })
  teamId!: string;

  @Column({ name: 'season_id', type: 'uuid' })
  seasonId!: string;

  @Column({ name: 'points_total', type: 'integer', default: 0 })
  pointsTotal!: number;

  @Column({ name: 'goal_threshold', type: 'integer' })
  goalThreshold!: number;

  @Column({
    type: 'enum',
    enum: TeamSeasonPotStatus,
    enumName: 'team_season_pot_status_enum',
    default: TeamSeasonPotStatus.ACTIVE,
  })
  status!: TeamSeasonPotStatus;
}
