import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { ParentalConsentStatus } from '../../players/player-consent-status.enum';

export enum ConsentMethod {
  EMAIL_LINK = 'email_link',
  IN_APP_BY_PARENT_ACCOUNT = 'in_app_by_parent_account',
  // Age-banded self-verification (13+, Swedish GDPR Art. 8's actual legal
  // minimum via Dataskyddslagen 2018:218 Ch.2§4) — added 2026-07-27, per
  // docs/adr/0002-data-model.md addendum §2's own anticipation of this
  // extension. The token/expiry/approve mechanism is identical to
  // EMAIL_LINK; only who the email is addressed to (and the page/email
  // copy) differs — see is-self-verification-age.util.ts.
  SELF_EMAIL_LINK = 'self_email_link',
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
