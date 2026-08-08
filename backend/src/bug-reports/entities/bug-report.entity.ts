import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PlayerLocale } from '../../common/locale/player-locale.enum';
import { BUG_REPORT_DESCRIPTION_MAX_LENGTH } from '../bug-reports.constants';

// docs/adr/0022-admin-control-center.md Decision 7's fixed category
// vocabulary. Kid-legible labels live in the mobile app / admin console
// (docs/design/phase7-admin-console-flows.md §6.6, §9.2) — the wire values
// stay these stable snake_case identifiers so a copy change never needs a
// migration.
export enum BugReportCategory {
  CRASH = 'crash',
  LOGIN_ISSUE = 'login_issue',
  MISSING_OR_WRONG_DATA = 'missing_or_wrong_data',
  UPLOAD_FAILED = 'upload_failed',
  OTHER = 'other',
}

export enum BugReportPlatform {
  IOS = 'ios',
  ANDROID = 'android',
  WEB = 'web',
}

/**
 * docs/design/phase7-admin-console-flows.md §9.3's exact 10 values, in the
 * picker's own order. **A real Postgres enum, never a varchar** — Decision
 * 7's 2026-08-02 security-reviewer correction is explicit that the original
 * draft "typed `screen` as a plain `varchar` while describing it in prose as
 * a fixed, allow-listed screen identifier", i.e. the schema didn't enforce
 * the claim the prose made. It does now.
 *
 * Two deliberate differences from Decision 7's own illustrative list, both
 * argued in §9.3 and neither an expansion of what's captured:
 *
 * - `roster` is folded into `team` (it's the Team tab's own sub-screen, and
 *   no child would distinguish the two);
 * - `clip_upload` and `leaderboard` are added, because `UploadFlow` and
 *   `LeaderboardScreen` are real, distinct, frequently-broken surfaces.
 *
 * Also per §9.3: this value is **picked by the player**, not auto-captured.
 * `ProfileScreen` is only reachable from the Home tab, so an auto-captured
 * value would be the constant `home` — a constant that looks like a signal.
 * That makes this a *reduction* in what the app observes about the child
 * (it records only what they chose to tell us), which is always safe against
 * Decision 7's capture allow-list.
 */
export enum BugReportScreen {
  HOME = 'home',
  CHAT = 'chat',
  CLIPS = 'clips',
  CLIP_UPLOAD = 'clip_upload',
  GOAL = 'goal',
  TEAM = 'team',
  LEADERBOARD = 'leaderboard',
  PROFILE = 'profile',
  ONBOARDING = 'onboarding',
  OTHER = 'other',
}

/**
 * Decision 7's triage states. Transitions are deliberately UNRESTRICTED
 * (`open ⇄ triaged ⇄ closed`), not forward-only — see
 * docs/design/phase7-admin-console-flows.md §6.4: there is one operator, no
 * audit trail, and a mis-clicked "Closed" that can't be undone from the UI
 * would send that operator to `psql`, which is the exact thing this console
 * exists to replace.
 */
export enum BugReportStatus {
  OPEN = 'open',
  TRIAGED = 'triaged',
  CLOSED = 'closed',
}

/**
 * docs/adr/0022-admin-control-center.md Decision 7 — a **technical** bug
 * report, authored by whoever hit the problem and routed to the developer.
 * Deliberately NOT a reuse of `ClipReport`/`TeamChatMessageReport`, which
 * are peer content-moderation reports routed to another family; it only
 * borrows their structural patterns (rate limiting, a fixed-vocabulary
 * category alongside capped freeform text).
 *
 * **The capture allow-list is this column list, and nothing else.** Per
 * Decision 7: app version, platform, OS version, the screen the child
 * chose, locale, timestamp — and *never* device geolocation (CLAUDE.md's
 * non-negotiable), never a device identifier/advertising id, never an IP
 * address, never an automatically-attached "recent action trail". Adding a
 * column here is a change to that allow-list, not a schema tweak.
 *
 * **Why carrying `player_id` doesn't breach Decision 5's aggregate-only
 * floor** (argued in Decision 7, restated here because this is the entity a
 * future contributor would look at): a bug report is a voluntary,
 * single-incident, self-initiated submission by the specific child it's
 * about — structurally closer to a `ClipReport` than to a passive
 * behavioural trail. Decision 5's floor exists to stop this admin surface
 * becoming a standing capability to look up an arbitrary child's ongoing
 * behaviour; a bug report is the opposite shape. What that *does* forbid,
 * explicitly: this identity must never be joined into or aggregated
 * alongside the usage-metrics pipeline (no "bug reports per player/team"
 * view, ever) — see Decision 5's own named anti-pattern.
 *
 * **Erasure**: `player_id` is `ON DELETE CASCADE` (see the migration),
 * mirroring `ClipReport.reporter_player_id`'s already-established treatment
 * in docs/adr/0013-account-erasure.md's per-entity table — "their own filed
 * report, their own action, fine to remove with the rest of their content".
 * The admin console has to handle a report vanishing mid-session because of
 * this (§6.4's `gone` state → the 404 from PATCH).
 */
@Entity('bug_report')
// The admin queue is always "newest first, optionally narrowed to one
// status" (docs/design/phase7-admin-console-flows.md §6.1). Plain ASC on
// created_at: Postgres scans a btree backwards for ORDER BY ... DESC just as
// cheaply, and keeping the entity metadata identical to the migration avoids
// spurious `migration:generate` diffs.
@Index('IDX_bug_report_created_at', ['createdAt'])
@Index('IDX_bug_report_status_created_at', ['status', 'createdAt'])
export class BugReport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // No relation decorator, matching this codebase's existing convention for
  // player-owned rows (ClipReport, AccountErasureRequest): the FK constraint
  // lives in the migration, the entity holds the plain id. Nothing in the
  // admin read path eager-loads a Player through TypeORM — see
  // AdminBugReportsService, which joins explicitly and selects exactly two
  // identity columns.
  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  @Column({
    type: 'enum',
    enum: BugReportCategory,
    enumName: 'bug_report_category_enum',
  })
  category!: BugReportCategory;

  // Optional, capped freeform. Decision 7 chose to include it deliberately:
  // "a technical bug description a 9-13-year-old writes in their own words
  // is materially more useful than a category enum alone", and since it's
  // routed only to the developer and never displayed to a peer, ADR-0007's
  // peer-facing chat-moderation filter doesn't apply the same way.
  //
  // This value — like app_version/os_version and the reporter's own screen
  // name/team name — is attacker-controllable by any authenticated client
  // and must be HTML-escaped wherever the admin console renders it
  // (Decision 7's 2026-08-02 correction, widened by
  // docs/design/phase7-admin-console-flows.md §6.2 to the identity fields).
  @Column({
    type: 'varchar',
    length: BUG_REPORT_DESCRIPTION_MAX_LENGTH,
    nullable: true,
  })
  description!: string | null;

  // Auto-captured from the Expo build (§9.2). Length-capped at the DTO
  // boundary rather than trusted to be short — it's client-supplied text,
  // not a value this app generates.
  @Column({ name: 'app_version', type: 'varchar' })
  appVersion!: string;

  @Column({
    type: 'enum',
    enum: BugReportPlatform,
    enumName: 'bug_report_platform_enum',
  })
  platform!: BugReportPlatform;

  // Nullable: §13's own instruction to frontend-developer is to send
  // `null`/omit rather than add a device-info library if the value isn't
  // cleanly available from Expo's own constants.
  @Column({ name: 'os_version', type: 'varchar', nullable: true })
  osVersion!: string | null;

  @Column({
    type: 'enum',
    enum: BugReportScreen,
    enumName: 'bug_report_screen_enum',
  })
  screen!: BugReportScreen;

  // Reuses ADR-0014's existing `player_locale_enum` type rather than
  // declaring a parallel one (`enumName` points at the same Postgres type
  // `player.locale` already uses) — one vocabulary for "which of 8
  // languages", so the two can never drift apart. Not a location signal:
  // see PlayerLocale's own comment and CLAUDE.md's non-negotiables.
  @Column({
    type: 'enum',
    enum: PlayerLocale,
    enumName: 'player_locale_enum',
  })
  locale!: PlayerLocale;

  @Column({
    type: 'enum',
    enum: BugReportStatus,
    enumName: 'bug_report_status_enum',
    default: BugReportStatus.OPEN,
  })
  status!: BugReportStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  // No location field of any kind, per CLAUDE.md's non-negotiable
  // constraints and Decision 7's explicit capture allow-list — do not add
  // one here, and do not add a device identifier, advertising id, IP
  // address, or action trail either.
}
