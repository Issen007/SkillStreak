import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  EVENT_REGISTRATION_CAMPAIGN_MAX_LENGTH,
  EVENT_REGISTRATION_EMAIL_MAX_LENGTH,
  EVENT_REGISTRATION_NAME_MAX_LENGTH,
  EVENT_REGISTRATION_NOTE_MAX_LENGTH,
} from '../event-registrations.constants';

/**
 * Why someone signed up. Drives which follow-up they get, and is the one
 * field that makes the list useful rather than just long.
 */
export enum EventRegistrationInterest {
  CURIOUS = 'curious',
  INVEST = 'invest',
  /**
   * Added 2026-08-20 at the project owner's request: someone offering to
   * join as a co-owner, not merely to fund or to help.
   *
   * Deliberately its own value rather than folded into `INVEST`, even
   * though the two sit next to each other on the form. "Tell me about
   * investing" is a request for information; "I want to be a co-owner" is
   * an offer about ownership of the company, and the follow-up those two
   * deserve is not the same conversation. Collapsing them would make the
   * list shorter and the one row that matters most impossible to find.
   */
  CO_OWNER = 'co_owner',
  CONTRIBUTE = 'contribute',
  TRAINER = 'trainer',
  OTHER = 'other',
}

/**
 * Which language the form was filled in, so a follow-up arrives in the
 * one they chose. The public site is Swedish/English only — deliberately
 * NOT reusing `player_locale_enum` (8 values), because that vocabulary
 * describes what the *app* is translated into and the two would drift.
 */
export enum EventRegistrationLocale {
  SV = 'sv',
  EN = 'en',
}

/**
 * Someone who asked to attend a SkillStreak demo.
 *
 * **This is adult marketing data and must stay away from child data.**
 * That separation is the entire reason this is its own table and its own
 * admin surface rather than a column on anything existing:
 *
 * - There is no `player_id`, no `team_id`, and no foreign key to either.
 *   Nothing here may ever be joined to a roster, a training log, or the
 *   usage-metrics pipeline. A registrant is a stranger who filled in a
 *   form; a player is a child under a parental-consent regime, and a
 *   query that puts them in the same result set is a category error
 *   before it is a privacy one.
 * - It must not be reachable through any player-facing or PT-facing
 *   route. The only read path is admin-only (see
 *   AdminEventRegistrationsController).
 *
 * **Lawful basis is consent**, captured explicitly: `privacy_accepted_at`
 * is NOT NULL, so a row cannot exist without the moment the person agreed.
 * A boolean would have recorded the same claim less usefully — "when" is
 * what you need if anyone ever asks.
 *
 * **Deliberately not captured**: no IP address, no user agent, no tracking
 * or campaign cookie, no third-party analytics identifier. `campaign` is
 * set from a plain query parameter on the link the person followed, which
 * is all the attribution this needs and keeps the project's standing "no
 * trackers" answer true (see docs/RELEASING.md).
 */
@Entity('event_registration')
@Index('IDX_event_registration_created_at', ['createdAt'])
// Registering twice is a normal accident, not an error worth surfacing:
// the service upserts on this index and the endpoint answers the same way
// either way, so the form never reveals whether an address is already on
// the list.
@Index('UQ_event_registration_email', ['email'], { unique: true })
export class EventRegistration {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: EVENT_REGISTRATION_NAME_MAX_LENGTH })
  name!: string;

  // Stored lower-cased and trimmed by the service, so the unique index
  // above actually means "one person" rather than "one spelling".
  @Column({ type: 'varchar', length: EVENT_REGISTRATION_EMAIL_MAX_LENGTH })
  email!: string;

  @Column({
    type: 'enum',
    enum: EventRegistrationInterest,
    enumName: 'event_registration_interest_enum',
  })
  interest!: EventRegistrationInterest;

  // Free text from a stranger on a public form. Attacker-controllable by
  // definition — HTML-escape it everywhere the admin console renders it.
  @Column({
    type: 'varchar',
    length: EVENT_REGISTRATION_NOTE_MAX_LENGTH,
    nullable: true,
  })
  note!: string | null;

  @Column({
    type: 'enum',
    enum: EventRegistrationLocale,
    enumName: 'event_registration_locale_enum',
  })
  locale!: EventRegistrationLocale;

  // Which campaign link brought them here (?campaign=linkedin-sv). Also
  // attacker-controllable — same escaping rule as `note`.
  @Column({
    type: 'varchar',
    length: EVENT_REGISTRATION_CAMPAIGN_MAX_LENGTH,
    nullable: true,
  })
  campaign!: string | null;

  @Column({ name: 'privacy_accepted_at', type: 'timestamptz' })
  privacyAcceptedAt!: Date;

  /**
   * When the demo invitation was mailed, or null if it has not been.
   *
   * This is what makes "send the invites" idempotent. Without it an admin
   * clicking twice mails the whole list twice, which is the fastest way to
   * teach people to mark us as spam — and a damaged sending reputation
   * takes the parental-consent email down with it.
   */
  @Column({ name: 'invite_sent_at', type: 'timestamptz', nullable: true })
  inviteSentAt!: Date | null;

  /**
   * When this person asked to be told about new releases, or null if they
   * never did.
   *
   * Separate from `interest` because the two are orthogonal: "I want to be
   * a co-owner" and "mail me when it ships" are both true of the same
   * person, and a single-select field can only hold one of them.
   *
   * A timestamp rather than a boolean, for the same reason
   * `privacy_accepted_at` is one — this is the record of a consent, and
   * *when* is the part worth being able to produce.
   *
   * **Only ever moves null → now.** Nothing in the public path clears it;
   * coming off this list happens through the unsubscribe code, which
   * removes the row outright.
   */
  @Column({
    name: 'release_updates_opted_in_at',
    type: 'timestamptz',
    nullable: true,
  })
  releaseUpdatesOptedInAt!: Date | null;

  /**
   * When this person asked to be invited to a live demo, or null.
   *
   * Every row that predates 2026-08-21 has this set (see the migration's
   * backfill): the form *was* the demo signup, so that is what they
   * consented to. Rows created after it only have it if the box was
   * ticked, which is what makes `sendInvites` safe to run against the
   * whole table.
   */
  @Column({
    name: 'demo_invite_requested_at',
    type: 'timestamptz',
    nullable: true,
  })
  demoInviteRequestedAt!: Date | null;

  /**
   * Carried in every email as the one-click way off the list.
   *
   * Generated by Postgres (see the migration's column default), never by
   * the application — so it cannot be forgotten on an insert path, and
   * existing rows got one the moment the column was added.
   */
  @Column({ name: 'unsubscribe_code', type: 'varchar', length: 32 })
  unsubscribeCode!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
