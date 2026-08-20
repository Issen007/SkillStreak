import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Which language the marketing site was being read in.
 *
 * A fixed vocabulary for the same reason `TrackedLink` is one: the
 * endpoint that writes this is unauthenticated, so an open text column
 * would be an unbounded write surface for anyone on the internet. These
 * are the two languages `site/i18n.js` actually offers; adding a third is
 * a migration, deliberately a visible change rather than something a page
 * can invent at runtime.
 */
export enum SiteLocale {
  SV = 'sv',
  EN = 'en',
}

/**
 * How much the public marketing site was read on a given day, per
 * language.
 *
 * **A counter, not an event log** — the same shape, and the same reasons,
 * as `LinkClick` next door. One row per (locale, day), incremented in
 * place. There is no row per visit and no row per person, so this table
 * cannot answer "who visited" or "which pages did this one person read":
 * not because the data is protected, but because it was never collected.
 *
 * No session, cookie, IP, user agent, referrer, screen size, or sub-day
 * timestamp, and none may be added without an ADR. Each one turns an
 * aggregate counter into something that could follow an individual around
 * a site children reach, and would falsify the "no third-party trackers"
 * answer `docs/RELEASING.md` depends on for the store review.
 *
 * ## What this therefore cannot tell you, stated plainly
 *
 * **`views` counts page views, not people.** One person reading the page
 * three times is three views. Distinguishing them would require exactly
 * the per-visitor identifier this design refuses to collect — and on a
 * child-directed site that identifier would also drag in an ePrivacy
 * consent banner, since an analytics cookie is not "strictly necessary".
 * The number is real and useful for trend and for language split; it is
 * not a headcount, and the console labels it as views for that reason.
 *
 * ## Why dwell is a sum and a count, not a list
 *
 * Storing each visit's duration would be an event log by another name —
 * a list of durations on a given day is a weak fingerprint, and it grows
 * without bound. A running total plus a sample count answers "how long
 * does a typical reader stay" with two integers and forgets everything
 * else. It cannot produce a median or a distribution, which is the
 * honest cost of not keeping the individual numbers.
 */
@Entity('site_visit')
@Index('UQ_site_visit_locale_day', ['locale', 'day'], { unique: true })
export class SiteVisit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'enum',
    enum: SiteLocale,
    enumName: 'site_visit_locale_enum',
  })
  locale!: SiteLocale;

  /** Date only. Deliberately no time — see the class docstring. */
  @Column({ type: 'date' })
  day!: string;

  /** Page views. See the docstring: views, not unique people. */
  @Column({ type: 'integer', default: 0 })
  views!: number;

  /**
   * How many visits reported a duration.
   *
   * Always <= `views`, and usually smaller: a reader who closes the tab
   * in a way that fires no `pagehide` reports nothing. The average is
   * therefore over the visits we could observe, not over all of them,
   * which is why this count is published alongside it rather than hidden.
   */
  @Column({ type: 'integer', default: 0 })
  dwell_samples!: number;

  /**
   * Total observed reading seconds. `bigint` because it accumulates
   * forever within a day and an `integer` would overflow at ~68 years of
   * summed reading — unlikely, but the wrong thing to have to reason
   * about. TypeORM maps bigint to string; the service coerces on read.
   */
  @Column({ type: 'bigint', default: 0 })
  dwell_seconds_total!: string;
}
