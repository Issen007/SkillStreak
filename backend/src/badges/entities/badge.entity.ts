import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

// Static-ish catalog of available badges (seeded data, not user-generated
// in Fas 1-2) — see docs/adr/0002-data-model.md. No award logic or
// endpoints exist yet in Phase 1; this table exists so the schema doesn't
// need reshaping when Phase 2/3 badge-awarding logic lands.
@Entity('badge')
export class Badge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  key!: string;

  @Column({ name: 'display_name', type: 'varchar' })
  displayName!: string;

  @Column({ type: 'varchar' })
  description!: string;

  @Column({ type: 'varchar' })
  icon!: string;
}
