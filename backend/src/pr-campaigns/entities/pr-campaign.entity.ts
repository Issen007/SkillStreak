import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum PrCampaignChannel {
  LINKEDIN = 'linkedin',
  FACEBOOK = 'facebook',
  INSTAGRAM = 'instagram',
  EMAIL = 'email',
  OTHER = 'other',
}

/** Who a post is written for. Four audiences want four different posts —
 *  see docs/CAMPAIGNS.md, which this table tracks the execution of. */
export enum PrCampaignAudience {
  GENERAL = 'general',
  INVESTORS = 'investors',
  CONTRIBUTORS = 'contributors',
  TRAINERS = 'trainers',
}

export enum PrCampaignStatus {
  DRAFT = 'draft',
  SCHEDULED = 'scheduled',
  POSTED = 'posted',
  ARCHIVED = 'archived',
}

export enum PrCampaignLocale {
  SV = 'sv',
  EN = 'en',
}

/**
 * One campaign: a post, for an audience, on a channel, in a language.
 *
 * **Adult marketing data**, held to the same separation as
 * `event_registration`: no player, no team, no foreign key to either, and
 * nothing here may ever be joined to a roster.
 *
 * `tag` is the attribution key — it matches the `?campaign=` value on the
 * link, which lands in `event_registration.campaign`. Deliberately a
 * string match rather than a real foreign key: a link gets posted before
 * this row exists and keeps working after it is deleted, and a stranger's
 * signup must never fail because a marketing record is missing.
 */
@Entity('pr_campaign')
@Index('UQ_pr_campaign_tag', ['tag'], { unique: true })
export class PrCampaign {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  /** Appears in links as `?campaign=<tag>`. Unique — two campaigns sharing
   *  one would make their signup counts quietly wrong. */
  @Column({ type: 'varchar', length: 64 })
  tag!: string;

  @Column({
    type: 'enum',
    enum: PrCampaignChannel,
    enumName: 'pr_campaign_channel_enum',
  })
  channel!: PrCampaignChannel;

  @Column({
    type: 'enum',
    enum: PrCampaignAudience,
    enumName: 'pr_campaign_audience_enum',
  })
  audience!: PrCampaignAudience;

  @Column({
    type: 'enum',
    enum: PrCampaignLocale,
    enumName: 'pr_campaign_locale_enum',
  })
  locale!: PrCampaignLocale;

  @Column({
    type: 'enum',
    enum: PrCampaignStatus,
    enumName: 'pr_campaign_status_enum',
    default: PrCampaignStatus.DRAFT,
  })
  status!: PrCampaignStatus;

  /** The post copy itself. Rendered escaped everywhere — it is text the
   *  operator typed, not markup. */
  @Column({ type: 'text', nullable: true })
  body!: string | null;

  @Column({ name: 'planned_for', type: 'date', nullable: true })
  plannedFor!: string | null;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt!: Date | null;

  @Column({ name: 'posted_url', type: 'varchar', length: 500, nullable: true })
  postedUrl!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
