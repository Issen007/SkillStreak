import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { ParentalConsentStatus } from '../../players/player-consent-status.enum';

export enum ConsentMethod {
  EMAIL_LINK = 'email_link',
  IN_APP_BY_PARENT_ACCOUNT = 'in_app_by_parent_account',
}

// Append-only audit trail — never updated or deleted, only inserted into.
// Rationale (ADR-0002): a single mutable status field on Player tells you
// the *current* state; this table proves *when and how* it changed, which
// matters for a GDPR consent dispute. Only PlayerPrivateInfoModule may
// import this entity/repository.
@Entity('parental_consent_record')
export class ParentalConsentRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  @Column({
    type: 'enum',
    enum: ParentalConsentStatus,
    enumName: 'parental_consent_status_enum',
  })
  status!: ParentalConsentStatus;

  @Column({
    type: 'enum',
    enum: ConsentMethod,
    enumName: 'consent_method_enum',
  })
  method!: ConsentMethod;

  @Column({ name: 'recorded_at', type: 'timestamptz', default: () => 'now()' })
  recordedAt!: Date;
}
