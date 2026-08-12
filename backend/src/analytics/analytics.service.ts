import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { stockholmDateString } from '../common/time/stockholm-date.util';
import { LinkClick, TrackedLink } from './entities/link-click.entity';

export interface DailyPoint {
  day: string;
  value: number;
}

export interface LinkClickSeries {
  link: TrackedLink;
  total: number;
  daily: DailyPoint[];
}

export interface AdminAnalyticsResponse {
  windowDays: number;
  /** Every player account that exists. App-wide, so no team is implied. */
  totalPlayers: number;
  /** Players who logged training at least once, per day. */
  activePerDay: DailyPoint[];
  /** New player accounts per day. */
  signupsPerDay: DailyPoint[];
  linkClicks: LinkClickSeries[];
  totalClicks: number;
}

const DEFAULT_WINDOW_DAYS = 30;

/**
 * The admin console's analytics.
 *
 * **Everything here is app-wide.** There is no team or player dimension on
 * any query below, and none may be added: ADR-0020 Decision 5's floor is
 * that this surface never becomes a way to look up how a particular child
 * or team is behaving, and ADR-0022 Decision 4/5 hold that a browsable web
 * view is a stronger version of that risk than a monthly email.
 *
 * **`totalTeams` is deliberately not here**, mirroring
 * `admin-usage-metrics.view.ts`, which excludes it structurally and has a
 * test for its absence. Alongside the per-bucket team counts that view
 * already publishes, a total is the residual arithmetic the
 * minimum-population floor exists to prevent. `totalPlayers` carries no
 * such risk — it is one number about the whole app and implies nothing
 * about any team — which is why one is here and the other is not.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(LinkClick)
    private readonly linkClicks: Repository<LinkClick>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Increments today's counter for a link.
   *
   * A single UPSERT rather than read-then-write: clicks arrive
   * concurrently, and two requests reading "3" and both writing "4" would
   * silently lose one. `clicks + 1` is computed by Postgres under the
   * row lock the conflict already takes.
   */
  async recordClick(link: TrackedLink): Promise<void> {
    await this.linkClicks.query(
      `INSERT INTO link_click (link, day, clicks)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (link, day)
       DO UPDATE SET clicks = link_click.clicks + 1`,
      [link],
    );
  }

  async collect(
    windowDays = DEFAULT_WINDOW_DAYS,
  ): Promise<AdminAnalyticsResponse> {
    const days = Math.min(Math.max(Math.trunc(windowDays), 1), 365);

    const [totalPlayers, activeRows, signupRows, clickRows] = await Promise.all(
      [
        this.countPlayers(),
        this.activePerDay(days),
        this.signupsPerDay(days),
        this.clicksPerDay(days),
      ],
    );

    const linkClicks = this.groupClicks(clickRows, days);

    return {
      windowDays: days,
      totalPlayers,
      activePerDay: fillMissingDays(activeRows, days),
      signupsPerDay: fillMissingDays(signupRows, days),
      linkClicks,
      totalClicks: linkClicks.reduce((sum, series) => sum + series.total, 0),
    };
  }

  private async countPlayers(): Promise<number> {
    const rows = await this.dataSource.query<Array<{ count: string }>>(
      `SELECT COUNT(*)::text AS count FROM player`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * DISTINCT player per day — a player who logs four sessions is one
   * active player, not four. Counting rows instead would make a keen child
   * look like a growing user base.
   */
  private async activePerDay(days: number): Promise<DailyPoint[]> {
    const rows = await this.dataSource.query<
      Array<{ day: string; value: string }>
    >(
      `SELECT to_char(logged_at::date, 'YYYY-MM-DD') AS day,
              COUNT(DISTINCT player_id)::text AS value
         FROM training_log_entry
        WHERE logged_at >= CURRENT_DATE - ($1::int - 1)
        GROUP BY logged_at::date
        ORDER BY logged_at::date`,
      [days],
    );
    return rows.map((row) => ({ day: row.day, value: Number(row.value) }));
  }

  private async signupsPerDay(days: number): Promise<DailyPoint[]> {
    const rows = await this.dataSource.query<
      Array<{ day: string; value: string }>
    >(
      `SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day,
              COUNT(*)::text AS value
         FROM player
        WHERE created_at >= CURRENT_DATE - ($1::int - 1)
        GROUP BY created_at::date
        ORDER BY created_at::date`,
      [days],
    );
    return rows.map((row) => ({ day: row.day, value: Number(row.value) }));
  }

  private async clicksPerDay(
    days: number,
  ): Promise<Array<{ link: TrackedLink; day: string; value: number }>> {
    const rows = await this.dataSource.query<
      Array<{ link: TrackedLink; day: string; value: string }>
    >(
      `SELECT link, to_char(day, 'YYYY-MM-DD') AS day, clicks::text AS value
         FROM link_click
        WHERE day >= CURRENT_DATE - ($1::int - 1)
        ORDER BY day`,
      [days],
    );
    return rows.map((row) => ({
      link: row.link,
      day: row.day,
      value: Number(row.value),
    }));
  }

  private groupClicks(
    rows: Array<{ link: TrackedLink; day: string; value: number }>,
    days: number,
  ): LinkClickSeries[] {
    const byLink = new Map<TrackedLink, DailyPoint[]>();
    for (const row of rows) {
      const existing = byLink.get(row.link) ?? [];
      existing.push({ day: row.day, value: row.value });
      byLink.set(row.link, existing);
    }
    return [...byLink.entries()]
      .map(([link, daily]) => ({
        link,
        total: daily.reduce((sum, point) => sum + point.value, 0),
        daily: fillMissingDays(daily, days),
      }))
      .sort((a, b) => b.total - a.total);
  }
}

/**
 * Pads a sparse series so every day in the window has a point.
 *
 * A day with no activity is a real zero, and a chart that simply skips it
 * draws a straight line across the gap — which reads as "steady" when the
 * truth is "nobody came". Missing days are the most interesting ones on a
 * launch chart, so they have to be plotted rather than omitted.
 */
export function fillMissingDays(
  points: DailyPoint[],
  days: number,
  today = new Date(),
): DailyPoint[] {
  const known = new Map(points.map((point) => [point.day, point.value]));
  const filled: DailyPoint[] = [];

  // Anchored on the STOCKHOLM date, not the UTC one.
  //
  // The queries bucket on the Postgres session's local date
  // (`CURRENT_DATE`, `logged_at::date`), and this filled its labels from
  // `setUTCDate`/`toISOString`. Between midnight and 02:00 local time
  // those disagree: Postgres has already rolled to D+1 while UTC is still
  // D, so the row the SQL returned for D+1 matched no generated key and
  // was silently DROPPED — today's activity, signups and clicks simply
  // absent from the chart rather than shown as zero.
  //
  // `stockholmDateString` is the same helper the training-log day
  // boundary already uses, so the charts and the streaks now agree about
  // what "today" means. Stepping by UTC days from a Stockholm anchor is
  // DST-safe here because the anchor is re-derived per iteration.
  const anchor = new Date(`${stockholmDateString(today)}T12:00:00Z`);
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(anchor);
    date.setUTCDate(date.getUTCDate() - offset);
    const day = stockholmDateString(date);
    filled.push({ day, value: known.get(day) ?? 0 });
  }
  return filled;
}
