import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * The links on the public site worth counting.
 *
 * A fixed vocabulary, not a free string. The endpoint that writes this is
 * unauthenticated, so an open text column would be an unbounded write
 * surface for anyone on the internet. Adding a link here is a migration —
 * deliberately a visible, reviewable change rather than something a page
 * can invent at runtime.
 */
export enum TrackedLink {
  DEMO_SIGNUP = 'demo_signup',
  TRY_IT = 'try_it',
  GET_APP = 'get_app',
  TRAINERS = 'trainers',
  COACHES_SECTION = 'coaches_section',
  GITHUB = 'github',
  OTHER = 'other',
}

/**
 * How many times a link was clicked on a given day.
 *
 * **A counter, not an event log.** One row per (link, day), incremented in
 * place. There is no row per click and no row per person, so this table
 * cannot answer "who clicked" — not because the data is protected, but
 * because it was never collected.
 *
 * No session, cookie, IP, user agent, referrer, or sub-day timestamp, and
 * none may be added without an ADR: each turns an aggregate counter into
 * something that could follow an individual around a site children reach,
 * and would falsify the "no third-party trackers" answer docs/RELEASING.md
 * depends on for the store review.
 */
@Entity('link_click')
@Index('UQ_link_click_link_day', ['link', 'day'], { unique: true })
export class LinkClick {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: TrackedLink, enumName: 'link_click_link_enum' })
  link!: TrackedLink;

  /** Date only. Deliberately no time — see the class docstring. */
  @Column({ type: 'date' })
  day!: string;

  @Column({ type: 'integer', default: 0 })
  clicks!: number;
}
