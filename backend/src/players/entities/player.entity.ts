import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PlayerLocale } from '../../common/locale/player-locale.enum';
import { ParentalConsentStatus } from '../player-consent-status.enum';
import { TeamJoinStatus } from '../team-join-status.enum';

// Deliberately does NOT include real_name or parent_contact — those live in
// PlayerPrivateInfo (see docs/adr/0002-data-model.md's 2026-07-03 addendum
// §1). Nothing in this entity/table is off-limits for an ordinary
// leaderboard/feed/badge query, by construction.
@Entity('player')
@Index(['teamId', 'screenName'], { unique: true })
export class Player {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'team_id', type: 'uuid' })
  teamId!: string;

  @Column({ name: 'screen_name', type: 'varchar' })
  screenName!: string;

  @Column({ name: 'avatar_id', type: 'varchar' })
  avatarId!: string;

  // Year only — never a full date of birth, per ADR-0002 (coarse enough for
  // age-banded challenge targeting without being unnecessarily precise on a
  // child).
  @Column({ name: 'birth_year', type: 'smallint' })
  birthYear!: number;

  @Column({
    name: 'parental_consent_status',
    type: 'enum',
    enum: ParentalConsentStatus,
    enumName: 'parental_consent_status_enum',
    default: ParentalConsentStatus.PENDING,
  })
  parentalConsentStatus!: ParentalConsentStatus;

  // Added 2026-07-27: a second, independent gate alongside
  // parentalConsentStatus above — the team captain confirming a new
  // joiner is legitimate, not just whoever had the invite code. Default
  // is set per-row at creation time (OnboardingService), not by this
  // column's own DB default: APPROVED for whoever's join *created* the
  // team (they can't be pending approval from themselves), PENDING for
  // everyone joining an existing team via invite code. The DB default
  // below (PENDING) only matters if a row is ever inserted outside that
  // path (e.g. a future seed script).
  @Column({
    name: 'team_join_status',
    type: 'enum',
    enum: TeamJoinStatus,
    enumName: 'team_join_status_enum',
    default: TeamJoinStatus.PENDING,
  })
  teamJoinStatus!: TeamJoinStatus;

  // Denormalized streak fields, kept in sync with TrainingLogEntry inserts
  // in the same Postgres transaction (see TrainingLogsService) — durable so
  // "longest streak ever" survives a Redis flush/restart, per ADR-0002.
  @Column({ name: 'current_streak_count', type: 'integer', default: 0 })
  currentStreakCount!: number;

  @Column({ name: 'longest_streak_count', type: 'integer', default: 0 })
  longestStreakCount!: number;

  @Column({ name: 'last_trained_date', type: 'date', nullable: true })
  lastTrainedDate!: string | null;

  // Bearer-secret for the parental-consent approval link
  // (docs/api/phase1-contract.md step 6 / the new ConsentModule) — a 256-bit
  // token from crypto.randomBytes(32).toString('hex'), single-use (cleared
  // to null by PlayersService.approveByConsentToken once consumed) and
  // time-boxed by consentTokenExpiresAt. These are secrets, not player data:
  // NEVER add either column to a response DTO (GET /players/me etc.).
  @Column({
    name: 'consent_token',
    type: 'varchar',
    nullable: true,
    unique: true,
  })
  consentToken!: string | null;

  @Column({
    name: 'consent_token_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  consentTokenExpiresAt!: Date | null;

  // Kapten (team captain) flag — ADR-0005 Decision 1. Assigned manually
  // (seed/admin action, see src/scripts/seed.ts), never via an in-app
  // election flow. "At most one active captain per team" is enforced at
  // the DB level by a partial unique index
  // (idx_player_one_captain_per_team ON player(team_id) WHERE is_captain =
  // true — see the migration), not application logic alone.
  @Column({ name: 'is_captain', type: 'boolean', default: false })
  isCaptain!: boolean;

  // ADR-0004 Part 3: bumped by exactly one action in Phase 2 — a captain's
  // session-reissue trigger (see SessionService). JwtAuthGuard compares
  // this to the token's own `tokenVersion` claim on every guarded request;
  // a mismatch invalidates the token. A token minted before this column
  // existed carries no claim at all — treated as `tokenVersion: 0` (this
  // column's default), so rollout doesn't invalidate every session already
  // in the wild.
  @Column({ name: 'token_version', type: 'integer', default: 0 })
  tokenVersion!: number;

  // Single-use, short-TTL (15 min) human-typable code a captain generates
  // for a teammate who lost their session — deliberately a different shape
  // from consent_token (see ADR-0004 Part 3's "why a code, not a mailed
  // link" section): the recipient is the kid in front of the captain right
  // now, not an absent parent checking email later. Never add to a
  // response DTO except the one-time session-reissue trigger response
  // itself.
  @Column({
    name: 'session_reissue_code',
    type: 'varchar',
    nullable: true,
    unique: true,
  })
  sessionReissueCode!: string | null;

  @Column({
    name: 'session_reissue_code_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  sessionReissueCodeExpiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  // docs/adr/0014-multi-language-support.md Decision 1 (part a). Read by
  // practically every player-facing flow (session bootstrap, every
  // outbound lifecycle email) — the same broad-consumer profile as
  // birthYear above, which is why this lives directly on Player rather
  // than PlayerPrivateInfo. Not a location signal: "which of 8 languages"
  // is a content-rendering choice, never "where is this device" — see
  // CLAUDE.md's non-negotiable constraints and the ADR's Decision 5.
  @Column({
    name: 'locale',
    type: 'enum',
    enum: PlayerLocale,
    enumName: 'player_locale_enum',
    default: PlayerLocale.SV,
  })
  locale!: PlayerLocale;

  // No location field of any kind, per CLAUDE.md's non-negotiable
  // constraints — do not add one here.
}
