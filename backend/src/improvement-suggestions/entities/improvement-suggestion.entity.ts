import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PlayerLocale } from '../../common/locale/player-locale.enum';
import { IMPROVEMENT_SUGGESTION_BODY_MAX_LENGTH } from '../improvement-suggestions.constants';

/**
 * The same three triage states `BugReportStatus` uses, redeclared rather
 * than imported so the two queues can diverge later without a shared enum
 * forcing a migration on both. Transitions are likewise UNRESTRICTED
 * (`open ⇄ triaged ⇄ closed`): one operator, no audit trail, and a
 * mis-clicked "Closed" that cannot be undone from the UI sends that
 * operator to `psql` — the exact thing this console exists to replace.
 */
export enum ImprovementSuggestionStatus {
  OPEN = 'open',
  TRIAGED = 'triaged',
  CLOSED = 'closed',
}

/**
 * docs/adr/0037-in-app-improvement-suggestions.md — a player-authored
 * **request for enhancement**: "the app would be better if…", written in
 * the child's own words from the Tips tab and routed to the operator.
 *
 * Deliberately a sibling of `BugReport` rather than a `kind` column on it.
 * The two share a shape (voluntary player free text → one operator's
 * triage queue → 90-day sweep) but not a schema: a bug report's
 * `category`/`screen` are NOT NULL Postgres enums *because* a 2026-08-02
 * security review rejected the varchar draft, and folding suggestions in
 * would mean making both nullable — loosening a constraint that was
 * argued for, to save a table.
 *
 * **The capture allow-list is this column list, and nothing else** — the
 * body the child wrote, which build they wrote it from, which of the
 * eight languages they were reading, and when. Never device geolocation
 * (CLAUDE.md's non-negotiable), never a device identifier or advertising
 * id, never an IP address, never an action trail. It captures strictly
 * less than `bug_report` does: no platform and no OS version, because an
 * idea is not a device fault and nothing in triaging one needs them.
 * Adding a column here is a change to that allow-list, not a schema tweak.
 *
 * **Why carrying `player_id` doesn't breach ADR-0022 Decision 5's
 * aggregate-only floor**: identical to the argument Decision 7 makes for
 * `bug_report` — this is a voluntary, single-incident, self-initiated
 * submission by the child it is about, the opposite shape from a standing
 * capability to browse an arbitrary child's behaviour. What that does
 * forbid, explicitly: this identity must never be joined into or
 * aggregated alongside the usage-metrics pipeline (no "suggestions per
 * player/team" view, ever).
 *
 * **Erasure**: `player_id` is `ON DELETE CASCADE` (see the migration) —
 * their own submission, their own action, removed with the rest of their
 * content, exactly as `bug_report` and `clip_report` already are.
 */
@Entity('improvement_suggestion')
// The queue is always "newest first, optionally narrowed to one status" —
// a composite index so the status predicate and the ordering come from one
// index, plus a plain created_at index for the unfiltered view and for the
// weekly digest's window count. Both ASC: Postgres scans a btree backwards
// for ORDER BY ... DESC just as cheaply, and keeping the entity metadata
// identical to the migration avoids spurious `migration:generate` diffs.
@Index('IDX_improvement_suggestion_created_at', ['createdAt'])
@Index('IDX_improvement_suggestion_status_created_at', ['status', 'createdAt'])
export class ImprovementSuggestion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // No relation decorator, matching this codebase's convention for
  // player-owned rows (BugReport, ClipReport, AccountErasureRequest): the
  // FK constraint lives in the migration, the entity holds the plain id.
  // Nothing in the admin read path eager-loads a Player through TypeORM.
  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  /**
   * Required, unlike `BugReport.description`. A bug report without words
   * is still useful — the category and screen carry it — but a suggestion
   * with no body is nothing at all, so there is no picker here to fall
   * back on and no reason to accept an empty row.
   *
   * This value is attacker-controllable by any authenticated client and
   * must be HTML-escaped wherever the admin console renders it, exactly
   * like `BugReport.description` and the reporter's own screen name and
   * team name (ADR-0022 Decision 7's 2026-08-02 correction, widened by
   * docs/design/phase7-admin-console-flows.md §6.2 to the identity
   * fields). `screenName`/`teamName` still have no charset validation
   * anywhere in `backend/src`, so all three are stored-XSS carriers into a
   * page holding the admin session.
   */
  @Column({
    type: 'varchar',
    length: IMPROVEMENT_SUGGESTION_BODY_MAX_LENGTH,
  })
  body!: string;

  // Auto-captured from the Expo build. Length-capped at the DTO boundary
  // rather than trusted to be short — it's client-supplied text, not a
  // value this app generates.
  @Column({ name: 'app_version', type: 'varchar' })
  appVersion!: string;

  // Reuses ADR-0014's existing `player_locale_enum` type rather than
  // declaring a parallel one, so "which of 8 languages" has one vocabulary
  // app-wide. Captured per suggestion rather than read off `player.locale`
  // because a child can change language mid-session, and the operator
  // wants to know which language the text in front of them is in. Not a
  // location signal: see PlayerLocale's own comment.
  @Column({
    type: 'enum',
    enum: PlayerLocale,
    enumName: 'player_locale_enum',
  })
  locale!: PlayerLocale;

  @Column({
    type: 'enum',
    enum: ImprovementSuggestionStatus,
    enumName: 'improvement_suggestion_status_enum',
    default: ImprovementSuggestionStatus.OPEN,
  })
  status!: ImprovementSuggestionStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  // No location field of any kind, per CLAUDE.md's non-negotiable
  // constraints and the capture allow-list above — do not add one here,
  // and do not add a device identifier, advertising id, IP address, or
  // action trail either.
}
