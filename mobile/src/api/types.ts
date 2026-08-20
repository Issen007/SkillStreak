// Request/response shapes mirroring docs/api/phase1-contract.md exactly.
// Keep in lockstep with that doc — this file has no logic, just shapes.

export type ConsentStatus =
  | 'not_requested'
  | 'pending'
  | 'approved'
  | 'revoked';

// Added 2026-07-27 for captain approval of new team joins — a second,
// independent gate alongside ConsentStatus above.
export type TeamJoinStatus = 'pending' | 'approved' | 'rejected';

export type ActivityType = 'fitness' | 'drill' | 'running' | 'other';

// docs/adr/0014-multi-language-support.md Decision 1/2 (Fas 4.3, part a).
// Mirrors the backend's `PlayerLocale` enum
// (backend/src/common/locale/player-locale.enum.ts) exactly — a fixed
// 8-value set (widened 2026-08-01 to add German/Czech/French), not a
// freeform BCP-47 tag. Deliberately no region subtag (`nb`/`de`, never
// `nb-NO`/`de-DE`) — the point is "which of 8 languages," never "where is
// this device" (CLAUDE.md's no-location-tracking constraint).
export type PlayerLocale =
  | 'sv'
  | 'en'
  | 'fi'
  | 'da'
  | 'nb'
  | 'de'
  | 'cs'
  | 'fr'
  | 'es';

// --- 1. GET /teams/invite/:inviteCode --------------------------------------

export interface InvitePreviewResponse {
  teamId: string;
  teamName: string;
}

// --- 2. POST /players -------------------------------------------------------

export interface CreatePlayerRequest {
  inviteCode: string;
  screenName: string;
  avatarId: string;
  birthYear: number;
  parentContact: string;
  // NEW (docs/adr/0009-self-service-team-creation.md / phase1-contract.md's
  // 2026-07-09 addendum) — present if and only if a prior
  // GET /teams/invite/:inviteCode 404'd and the player chose to create a
  // team instead of retrying. Absent -> byte-for-byte the previous
  // behavior (join-only, existing 404 if the code doesn't match).
  teamName?: string;
  // NEW (docs/adr/0014-multi-language-support.md Decision 2, Fas 4.3) —
  // the language chosen at Screen O0, submitted alongside everything else
  // collected during onboarding. Optional so an old app build that hasn't
  // shipped Screen O0 yet keeps working unchanged; the backend column
  // defaults to `sv` when omitted.
  locale?: PlayerLocale;
}

export interface CreatePlayerResponse {
  playerId: string;
  teamId: string;
  // NEW, same addendum — the joined-or-created team's actual name; the
  // create path has no O2-equivalent preview, so this is the client's only
  // server-confirmed copy of the accepted name.
  teamName: string;
  // NEW — true only when this exact request is the one that created the
  // team (not merely "this team happens to be recently created"). Kept
  // separate from `isCaptain` deliberately, per ADR-0009 Decision 2.
  teamCreated: boolean;
  // NEW — always present now; true iff `teamCreated` is true, for Phase 1.
  isCaptain: boolean;
  screenName: string;
  avatarId: string;
  consentStatus: ConsentStatus;
  // Added 2026-07-27 for age-banded self-verification (13+) — lets the
  // post-signup waiting screen show the right copy immediately.
  isSelfVerification: boolean;
  // Added 2026-07-27 for captain approval of new team joins.
  teamJoinStatus: TeamJoinStatus;
  sessionToken: string;
}

// --- 3. POST /training-logs ---------------------------------------------------

export interface CreateTrainingLogRequest {
  activityType: ActivityType;
  durationMinutes: number;
  challengeId?: string;
  /** docs/adr/0025 — a published clip offered as proof of this session.
   * Omitted means a plain tap, which is exactly today's behaviour. */
  evidenceClipId?: string;
  /** Whether that clip was shared with the team — the difference between
   * tier 3 and tier 4. Ignored without an `evidenceClipId`. */
  sharedWithTeam?: boolean;
}

/** What the player chose to offer as proof, before any clip exists yet.
 * docs/adr/0025 Decision 1: the multiplier is shown for each of these
 * BEFORE the choice is made, never applied afterwards. */
export type EvidenceChoice = 'none' | 'video' | 'video_shared';

/** Kept in lockstep with backend/src/training-logs/points.util.ts. A
 * mismatch would show a child one number and pay another, which is worse
 * than showing no number at all. */
export const EVIDENCE_MULTIPLIER: Record<EvidenceChoice, number> = {
  none: 0.1,
  video: 1.2,
  video_shared: 1.4,
};

/**
 * The same whole-points rule the backend applies — round to nearest, never
 * below 1. Duplicated rather than fetched because the picker has to show a
 * number *before* anything is sent, and it must be the number that will
 * actually be paid: 15 minutes unproven is 1.5, shown and paid as 2.
 */
export function evidencePointsPreview(
  durationMinutes: number,
  choice: EvidenceChoice,
): number {
  return Math.max(1, Math.round(durationMinutes * EVIDENCE_MULTIPLIER[choice]));
}

export interface TrainingLogResponse {
  trainingLogId: string;
  loggedAt: string;
  streak: {
    currentStreakCount: number;
    longestStreakCount: number;
    alreadyLoggedToday: boolean;
    // NEW (docs/adr/0024-streak-savers.md, docs/design/streak-savers-ui.md
    // §0) — post-transaction banked-saver balance (0-4), and whether/how
    // many banked savers this exact log just spent to bridge a gap.
    // `streakSaverSpent` is deliberately singular here (the response field
    // name), distinct from the backend-internal `streakSaversSpent`.
    bankedStreakSaverCount: number;
    streakSaverSpent: number;
    streakSaverEarned: boolean;
  };
  // Fas 2.7 (ADR-0008 Decision 4): goalThreshold/percentComplete removed —
  // there's no fixed maximum anymore. Deliberately no `rank` here either
  // (see the contract's hot-path reasoning) — a client wanting an updated
  // rank re-fetches GET /players/me or the dashboard after logging.
  teamPool: {
    pointsTotal: number;
  };
  // NEW in Phase 2 (docs/api/phase2-contract.md, ADR-0005 Decision 3): only
  // non-null on the one log whose insertion caused the team to cross its
  // active weekly goal's target for the first (and only) time. See Screen
  // G2 (docs/design/phase2-flows.md Part 3).
  goalBonus: { awardedPoints: number } | null;
}

// --- 4. GET /players/me ------------------------------------------------------

export interface PlayerMeResponse {
  player: {
    id: string;
    screenName: string;
    avatarId: string;
    consentStatus: ConsentStatus;
    // Added 2026-07-27 for age-banded self-verification (13+).
    isSelfVerification: boolean;
    // Added 2026-07-27 for captain approval of new team joins.
    teamJoinStatus: TeamJoinStatus;
    // ADR-0014 Decision 2 — restored into i18next by AppShell on every
    // app boot (the post-auth "server value is source of truth" flip).
    locale: PlayerLocale;
  };
  team: {
    teamId: string;
    teamName: string;
  };
  streak: {
    currentStreakCount: number;
    longestStreakCount: number;
    // Not patched by HomeScreen after a training log (`POST
    // /training-logs`'s response doesn't return it), so this goes stale
    // immediately after a log. Currently unused by any component — if you
    // add a consumer, re-fetch `me` first rather than trusting this value.
    lastTrainedDate: string | null;
    alreadyLoggedToday: boolean;
    // NEW (docs/adr/0024-streak-savers.md, docs/design/streak-savers-ui.md
    // §0/§1) — current banked-saver balance (0-4), always present whenever
    // `me` loads (drives StreakCard's badge, §1). `pendingStreakGap` is
    // non-null for ANY open gap of 1+ missed days, whether or not it's
    // actually coverable — `coverableWithBankedSavers` is what
    // distinguishes the two cases (StreakGapBanner, §2); see §0's note
    // that ADR-0024's own prose undersells this, confirmed against
    // `PlayersController.getMe` directly.
    bankedStreakSaverCount: number;
    pendingStreakGap: {
      missedDayCount: number;
      coverableWithBankedSavers: boolean;
    } | null;
  };
  // Fas 2.7 (ADR-0008 Decision 4): goalThreshold/percentComplete removed,
  // rank/teamCount added — see docs/api/phase2.7-contract.md. `rank`/
  // `teamCount` are typed as optional here even though the current backend
  // always returns them together with a successful response (it 500s
  // instead of omitting them for a team with no active pot, per
  // TeamPoolService.getActivePotForTeam) — kept optional defensively so
  // `TeamPoolCard`'s "between seasons" rendering path (Screen LB1) is
  // forward-compatible if that 500-on-missing-pot behavior is ever
  // softened, without a second breaking type change. See this task's final
  // report for the flagged discrepancy.
  // ADR-0016 addendum (2026-07-31), additive: `effortRank`/
  // `eligiblePlayerCount` alongside `rank`/`teamCount` above. `effortRank`
  // is `null` (not omitted) when this team's own `eligiblePlayerCount` is
  // `0` — same "between seasons" graceful-omission posture `TeamPoolCard`
  // already applies to `rank`/`teamCount` being `undefined`. Kept optional
  // here too (not required) for the same forward-compatibility reason as
  // `rank`/`teamCount` above.
  teamPool: {
    seasonId: string;
    seasonLabel: string;
    pointsTotal: number;
    status: string;
    rank?: number;
    teamCount?: number;
    effortRank?: number | null;
    eligiblePlayerCount?: number;
  };
}

// --- Phase 2 shapes, mirroring docs/api/phase2-contract.md exactly ---------

// Session-reissue/redeem (ADR-0004 Part 3), redesigned per that ADR's
// 2026-07-27 addendum — the code is emailed to the player's own
// parent_contact, never returned here. Two request shapes (captain-
// triggered, self-service) share the same generic-looking response shape
// on the wire but are typed separately since the self-service one is
// deliberately identical byte-for-byte whether or not a match was found.

export interface RequestSessionReissueRequest {
  inviteCode: string;
  screenName: string;
}

export interface SessionReissueTriggerResponse {
  requested: true;
  expiresAt: string;
}

export interface SessionReissueSelfServiceResponse {
  requested: true;
}

export interface RedeemSessionRequest {
  code: string;
}

export interface RedeemSessionResponse {
  playerId: string;
  sessionToken: string;
}

// docs/adr/0012-profile-page-and-contact-email-change.md (Fas 4.1).

// docs/adr/0014-multi-language-support.md Decision 2 — the post-auth
// "server value is source of truth" flip: AppShell calls
// i18n.changeLanguage(locale) from this field once it's fetched, so a
// returning player's saved choice wins over the device's own guess
// (src/i18n/deviceLocale.ts), which only matters pre-auth.
export interface PlayerProfileResponse {
  realName: string | null;
  birthYear: number;
  parentContact: string;
  avatarId: string;
  locale: PlayerLocale;
}

export interface UpdateProfileRequest {
  realName?: string | null;
  avatarId?: string;
  // NEW (docs/adr/0014-multi-language-support.md Consequences, Fas 4.3) —
  // same optional-PATCH-field addition as `CreatePlayerRequest.locale`
  // above; no in-app settings screen calls this yet (out of scope for
  // part (a) — the picker only lives at onboarding so far), but the
  // request shape is already fixed by the ADR regardless of backend
  // landing order.
  locale?: PlayerLocale;
}

export interface RequestContactChangeRequest {
  newContact: string;
}

export interface RequestContactChangeResponse {
  requested: true;
  expiresAt: string;
}

export interface ConfirmContactChangeResponse {
  confirmed: true;
  // security-reviewer finding, 2026-07-28 — confirming no longer applies
  // the change immediately; it starts a 24h grace period the OLD address
  // can cancel from. See docs/adr/0012's addendum.
  appliesAt: string;
}

export interface ConfirmContactChangeRequest {
  code: string;
}

export type WeeklyGoalStatus = 'draft' | 'active' | 'completed' | 'cancelled';

// Widened 2026-07-31 (docs/adr/0015-weekly-goal-per-player-completion.md
// Decision 1) — a `-pass` ("träningspass"/session) counterpart for each
// existing `-minuter` value, not a separate `targetUnit` column. Old
// clients sending one of the original 5 values are unaffected.
export type WeeklyGoalTargetMetric =
  | 'fitness-minuter'
  | 'drill-minuter'
  | 'running-minuter'
  | 'other-minuter'
  | 'total-minuter'
  | 'fitness-pass'
  | 'drill-pass'
  | 'running-pass'
  | 'other-pass'
  | 'total-pass';

// NEW 2026-07-31 (ADR-0015 Decision 3) — derived server-side from
// `targetMetric`, so the client never needs its own copy of the
// metric-to-unit lookup table.
export type WeeklyGoalTargetUnit = 'minutes' | 'sessions';

/** NEW 2026-07-31 (ADR-0015 Decision 3) — one roster member's progress
 * toward the active/draft goal. `exclusionReason` is always `null` for a
 * non-captain viewer, regardless of the real reason, including for
 * excluded players (ADR-0015 Decision 4 — a captain-only privacy gate the
 * client must not try to re-derive or guess around when it's null). */
export interface PlayerGoalProgress {
  playerId: string;
  screenName: string;
  avatarId: string;
  eligible: boolean;
  exclusionReason:
    | 'joined_after_start'
    | 'consent_pending'
    | 'consent_revoked'
    | 'team_join_pending'
    | null;
  progressValue: number;
  goalMet: boolean;
}

// --- 5. GET /teams/:teamId/dashboard ----------------------------------------

/** The dashboard's `weeklyGoal.current` block deliberately omits
 * `createdByPlayerId`/`teamId`/`bonusPointsAwarded` — matched exactly here
 * rather than as a superset of `GoalProgressSummary`, per the contract's own
 * note that this is intentional (endpoint 1's example), not an oversight.
 *
 * Breaking change 2026-07-31 (ADR-0015 Decision 3): `progressMinutes` is
 * renamed `teamBonusBasisMinutes` (team-wide minutes, the bonus basis
 * only — no longer what decides `goalMet`); `targetUnit`/`players`/
 * `eligiblePlayerCount`/`completedPlayerCount` are new, and `goalMet`/
 * `percentComplete` now describe per-player completion, not a pooled
 * total. */
export interface DashboardCurrentGoal {
  id: string;
  title: string;
  description: string;
  targetMetric: WeeklyGoalTargetMetric;
  targetValue: number;
  startDate: string;
  endDate: string;
  status: WeeklyGoalStatus;
  targetUnit: WeeklyGoalTargetUnit;
  players: PlayerGoalProgress[];
  eligiblePlayerCount: number;
  completedPlayerCount: number;
  teamBonusBasisMinutes: number;
  percentComplete: number;
  goalMet: boolean;
  bonusAwardedAt: string | null;
}

export interface TeamDashboardResponse {
  viewerIsCaptain: boolean;
  // Added 2026-07-26 for the "invite a friend" share feature — the only
  // other place this ever appeared was the one-time account-creation
  // response, with no way to retrieve it again afterward.
  inviteCode: string;
  teamName: string;
  roster: {
    totalCount: number;
    approvedCount: number;
    pendingCount: number;
    revokedCount: number;
  };
  // Fas 2.7 (ADR-0008 Decision 4): goalThreshold/percentComplete removed,
  // rank/teamCount added — see the equivalent note on PlayerMeResponse
  // above (same optional-defensively rationale).
  // ADR-0016 addendum (2026-07-31), additive — see the equivalent note on
  // PlayerMeResponse.teamPool above.
  teamPool: {
    seasonId: string;
    seasonLabel: string;
    pointsTotal: number;
    status: string;
    rank?: number;
    teamCount?: number;
    effortRank?: number | null;
    eligiblePlayerCount?: number;
    last7DaysLoggedCount: number;
  };
  weeklyGoal: {
    current: DashboardCurrentGoal | null;
    pastCount: { completed: number; cancelled: number };
  };
}

// --- 6. GET /teams/:teamId/roster -------------------------------------------
// Captain-only (403 `not_team_captain` otherwise) — see the client's
// `not_team_captain`-handling note next to `getTeamRoster`.

export interface RosterPlayer {
  playerId: string;
  screenName: string;
  avatarId: string;
  consentStatus: ConsentStatus;
  lastTrainedDate: string | null;
  // ADR-0006 Decision 2 — additive, non-breaking: a captain no longer needs
  // a second call (the teammates endpoint) to confirm their own status.
  isCaptain: boolean;
}

export interface TeamRosterResponse {
  players: RosterPlayer[];
}

// --- 7. POST /players/:playerId/consent-reminder ----------------------------

export interface ConsentReminderResponse {
  message: string;
  sentAt: string;
}

// --- 9/10. POST/PATCH .../weekly-goal ---------------------------------------

export interface CreateWeeklyGoalRequest {
  title: string;
  description: string;
  targetMetric: WeeklyGoalTargetMetric;
  targetValue: number;
  startDate: string;
  endDate: string;
  status: 'draft' | 'active';
}

export interface UpdateWeeklyGoalRequest {
  title?: string;
  description?: string;
  targetMetric?: WeeklyGoalTargetMetric;
  targetValue?: number;
  startDate?: string;
  endDate?: string;
  status?: 'active' | 'completed' | 'cancelled';
}

/** POST/PATCH's response shape — deliberately narrower than
 * `GoalProgressSummary` (no progress fields at creation/edit time), per the
 * contract's own note that these two share one shape distinct from the GET
 * endpoints below. */
export interface WeeklyGoalRow {
  id: string;
  teamId: string;
  createdByPlayerId: string;
  title: string;
  description: string;
  targetMetric: WeeklyGoalTargetMetric;
  targetValue: number;
  startDate: string;
  endDate: string;
  status: WeeklyGoalStatus;
}

// --- 11/12. GET .../weekly-goal, GET .../weekly-goal/history ----------------

/** Breaking change 2026-07-31 (ADR-0015 Decision 3, docs/api/
 * phase2-contract.md endpoint 7): `progressMinutes` is renamed
 * `teamBonusBasisMinutes`; `targetUnit`/`players`/`eligiblePlayerCount`/
 * `completedPlayerCount` are new; `goalMet`/`percentComplete` now describe
 * per-player completion (every eligible roster member individually
 * reaching `targetValue`), not a team-wide pooled total. */
export interface GoalProgressSummary {
  id: string;
  title: string;
  description: string;
  targetMetric: WeeklyGoalTargetMetric;
  targetValue: number;
  startDate: string;
  endDate: string;
  status: WeeklyGoalStatus;
  createdByPlayerId: string;
  targetUnit: WeeklyGoalTargetUnit;
  players: PlayerGoalProgress[];
  eligiblePlayerCount: number;
  completedPlayerCount: number;
  teamBonusBasisMinutes: number;
  percentComplete: number;
  goalMet: boolean;
  bonusAwardedAt: string | null;
  /** Added 2026-07-05 specifically so a non-triggering viewer (Screen G3)
   * can show the exact bonus figure without re-deriving it client-side
   * (an earlier `5 + targetValue` guess was found to systematically
   * undercount) — read directly, never computed. */
  bonusPointsAwarded: number | null;
}

export interface CurrentGoalResponse {
  goal: GoalProgressSummary | null;
  viewerIsCaptain: boolean;
}

export interface GoalHistoryResponse {
  goals: GoalProgressSummary[];
}

/** A subset of `GoalProgressSummary`/`DashboardCurrentGoal` needed to
 * pre-fill the goal builder (KB1-KB3) when editing an existing `draft` —
 * kept as its own small type so the builder doesn't need to accept two
 * differently-shaped "goal so far" objects. */
export interface EditableGoalFields {
  id: string;
  title: string;
  description: string;
  targetMetric: WeeklyGoalTargetMetric;
  targetValue: number;
  startDate: string;
  endDate: string;
}

// --- Fas 2.6a shapes, mirroring docs/adr/0006-captain-transfer.md +
// docs/api/phase2-contract.md's 2026-07-08 addendum exactly -----------------

/** endpoint 10, `GET .../teammates` — deliberately narrower than
 * `RosterPlayer` (no consentStatus/lastTrainedDate), open to every
 * teammate, not just the captain. Backs Screen K1's baseline "Spelare i
 * laget" section and Screen K4's transfer-target list. */
export interface TeammateEntry {
  playerId: string;
  screenName: string;
  avatarId: string;
  isCaptain: boolean;
}

export interface TeammatesResponse {
  teammates: TeammateEntry[];
}

export interface CaptainTransferRequest {
  newCaptainPlayerId: string;
}

export interface CaptainTransferResponse {
  teamId: string;
  previousCaptainPlayerId: string;
  newCaptainPlayerId: string;
  transferredAt: string;
}

// --- Fas 4 shapes: captain approval for new team joins ----------------------
// docs/adr/0009-self-service-team-creation.md's 2026-07-27 addendum.

export interface PendingJoinEntry {
  playerId: string;
  screenName: string;
  avatarId: string;
  createdAt: string;
}

export interface PendingJoinsResponse {
  pending: PendingJoinEntry[];
}

export interface TeamJoinDecisionResponse {
  playerId: string;
  teamJoinStatus: TeamJoinStatus;
}

// --- Fas 2.6b shapes, mirroring docs/api/phase2.6b-contract.md exactly -----

export type ChatReportReason =
  | 'bullying'
  | 'inappropriate_language'
  | 'spam'
  | 'other';

/** ADR-0017 (2026-07-31) — the nullable `clip` block on both `POST
 * .../chat/messages`'s response and `GET .../chat/messages`'s rows. Every
 * field here is resolved *live*, per request, from the clip's current row
 * (Decision 2) — never a snapshot. `null` on the `GET` shape collapses
 * every one of "never had a clipId," "clip self-deleted/expired,"
 * "clip report-hidden," and "viewer has blocked the uploader" into the
 * identical value — the client cannot and should not try to tell these
 * apart (see `ClipUnavailablePlaceholder`). */
export interface MessageClipEmbed {
  clipId: string;
  uploaderPlayerId: string;
  uploaderScreenName: string;
  uploaderAvatarId: string;
  caption: string | null;
  playbackUrl: string;
  createdAt: string;
}

/** endpoint 2, `GET .../chat/messages` row shape — also the shape of
 * endpoint 1's `POST .../chat/messages` response, minus `reportedByMe`
 * (a message the sender just posted couldn't have been reported by them
 * yet, so the client can safely default it to `false` locally). */
export interface ChatMessage {
  id: string;
  senderPlayerId: string | null;
  senderScreenName: string | null;
  senderAvatarId: string | null;
  /** ADR-0021 Decision 2 — the real discriminator for team chat's first
   * system-authored row. `'system'` means: no sender at all (all three
   * `sender*` fields above come back `null` from the server, from
   * creation), a fixed server-rendered Swedish `content` string, and no
   * report affordance (`MessageBubble` must check this *before* `isOwn`).
   * `'player'` with a null sender still means exactly what ADR-0013
   * Decision 6 established — "a real player, since erased". */
  authorType: 'player' | 'system';
  systemEventType: 'clip_challenge_issued' | null;
  content: string;
  clip: MessageClipEmbed | null;
  createdAt: string;
  reportedByMe: boolean;
}

export interface ChatMessagesResponse {
  messages: ChatMessage[];
}

export interface PostChatMessageRequest {
  content: string;
  // ADR-0017 Decision 5 — must resolve to a `published` clip on this team;
  // `404 clip_not_found` otherwise. Omitted entirely for a text-only send.
  clipId?: string;
}

export interface PostChatMessageResponse {
  id: string;
  teamId: string;
  senderPlayerId: string;
  senderScreenName: string;
  senderAvatarId: string;
  /** Always `'player'`/`null` here — this response only ever comes from
   * `postMessage`'s HTTP path, which can never write a system row (ADR-0021
   * Decision 3: neither field is exposed on any request DTO). Present for
   * shape-parity with `ChatMessage`, matching the backend's own
   * `ChatMessageResponse`, so `ChatScreen` can keep building its optimistic
   * message with a plain spread. */
  authorType: 'player' | 'system';
  systemEventType: 'clip_challenge_issued' | null;
  content: string;
  // Always populated when `clipId` was sent and accepted; `null` only when
  // no `clipId` was sent (ADR-0017 Decision 5) — the send response never
  // returns the "unavailable" null-for-another-reason case `GET` can.
  clip: MessageClipEmbed | null;
  createdAt: string;
}

export interface ReportChatMessageRequest {
  reason: ChatReportReason;
  note?: string;
}

export interface ReportChatMessageResponse {
  reportId: string;
  messageId: string;
  createdAt: string;
}

export interface BlockChatPlayerRequest {
  blockedPlayerId: string;
}

export interface BlockChatPlayerResponse {
  blockedPlayerId: string;
  createdAt: string;
}

export interface UnblockChatPlayerResponse {
  blockedPlayerId: string;
  unblocked: boolean;
}

// --- Fas 2.7 shapes, mirroring docs/api/phase2.7-contract.md exactly ------

export interface LeaderboardEntry {
  rank: number;
  teamId: string;
  teamName: string;
  pointsTotal: number;
  isRequestingTeam: boolean;
}

export interface LeaderboardResponse {
  requestingTeam: {
    teamId: string;
    teamName: string;
    pointsTotal: number;
    rank: number;
  } | null;
  /** The ±10 window around your own team, not the whole table — the
   * backend slices it there so a phone never receives thousands of rows
   * to show twenty of. */
  leaderboard: LeaderboardEntry[];
  /** Every team in the standings, so "12 av 2166" is renderable without
   * holding 2166 rows. */
  teamCount: number;
  // ADR-0016 addendum (2026-07-31), additive — the "Bästa laginsats" tab
  // (Screen LB2). Same `GET .../leaderboard` call, no new request.
  // `null` when the requesting team's own `eligiblePlayerCount` is `0`
  // (every player still consent-pending, or a brand-new team with no
  // approved joiner yet) — same posture as `requestingTeam`'s own `null`
  // case above.
  requestingTeamEffort: {
    teamId: string;
    teamName: string;
    // Requester's own count — always exact, never bucketed (only
    // `EffortLeaderboardEntry.eligiblePlayerCountRange` on *other* teams'
    // rows is bucketed, per the security-reviewer finding behind this
    // shape).
    eligiblePlayerCount: number;
    pointsPerPlayer: number;
    adjustedScore: number;
    rank: number;
  } | null;
  effortLeaderboard: EffortLeaderboardEntry[];
}

/** ADR-0016 addendum (2026-07-31) — a cross-team effort-leaderboard row.
 * `eligiblePlayerCountRange` is a deliberately bucketed display STRING
 * (`'1-2' | '3-5' | '6+'`), never an exact count, for every team but the
 * viewer's own — an exact count on a 1-2 player team would double as that
 * team's own child's consent/approval status leaking across a team
 * boundary. Never parse this back into a number; it is not sortable or
 * summable data, only a display string. */
export interface EffortLeaderboardEntry {
  rank: number;
  teamId: string;
  teamName: string;
  eligiblePlayerCountRange: '1-2' | '3-5' | '6+';
  pointsPerPlayer: number;
  adjustedScore: number;
  isRequestingTeam: boolean;
}

// --- Fas 3 shapes, mirroring docs/api/phase3-contract.md exactly -----------

export type ClipMimeType = 'video/mp4' | 'video/quicktime' | 'video/webm';

export type ClipReportReason =
  | 'appears_without_consent'
  | 'inappropriate_content'
  | 'not_training_related'
  | 'bullying'
  | 'other';

// --- 1. POST .../clips/upload-url -------------------------------------------

export interface CreateClipUploadUrlRequest {
  mimeType: ClipMimeType;
  fileSizeBytes: number;
  durationSeconds: number;
  caption?: string;
  taggedPlayerId?: string;
}

export interface CreateClipUploadUrlResponse {
  clipId: string;
  uploadUrl: string;
  uploadMethod: 'PUT';
  requiredHeaders: { 'Content-Type': string };
  expiresAt: string;
}

// --- 2. POST .../clips/:clipId/complete -------------------------------------

export interface CompleteClipUploadResponse {
  clipId: string;
  status: 'published';
  playbackUrl: string;
  caption: string | null;
  taggedPlayerId: string | null;
  createdAt: string;
  expiresAt: string;
}

// --- 3. GET .../clips --------------------------------------------------------

export interface ClipFeedItem {
  clipId: string;
  uploaderPlayerId: string;
  uploaderScreenName: string;
  uploaderAvatarId: string;
  taggedPlayerId: string | null;
  taggedScreenName: string | null;
  caption: string | null;
  playbackUrl: string;
  createdAt: string;
  reportedByMe: boolean;
  /** ADR-0030 — whether this clip is currently visible outside the team.
   * Drives the share row's on/off state on the owner's own clips. */
  publishedPublicly: boolean;
}

export interface ClipsResponse {
  clips: ClipFeedItem[];
}

// --- 4. DELETE .../clips/:clipId ---------------------------------------------

export interface DeleteClipResponse {
  clipId: string;
  deleted: true;
}

// --- 5. POST .../clips/:clipId/report ----------------------------------------

export interface ReportClipRequest {
  reason: ClipReportReason;
  note?: string;
}

export interface ReportClipResponse {
  reportId: string;
  clipId: string;
  createdAt: string;
}

// --- Fas 4.2 shapes, mirroring docs/adr/0013-account-erasure.md Decision 3 -
// (self-service GDPR account erasure). The two unauthenticated
// confirm/cancel-by-code routes are plain HTML pages the mailed link opens
// directly — no request/response shape needed here for those.

export interface RequestErasureRequest {
  successorPlayerId?: string;
}

export interface RequestErasureResponse {
  requested: true;
  expiresAt: string;
}

export type ErasureStatus = 'none' | 'requested' | 'grace_period';

export interface ErasureStatusResponse {
  status: ErasureStatus;
  scheduledFor?: string;
  successorScreenName?: string;
}

export interface CancelErasureResponse {
  cancelled: true;
}

// --- Fas 4.6 shapes, mirroring docs/adr/0021-clip-challenge-notifications.md
// Decision 1's two new endpoints exactly (verified against
// `backend/src/video-clips/video-clips.service.ts`'s `PendingChallengeItem`/
// `ChallengeAckResponse`, not just the ADR's sketch).

/** One unacknowledged "a teammate tagged you in a clip" challenge, from
 * `GET .../clips/challenges/pending`. Deliberately *not* a `ClipFeedItem`:
 * the endpoint carries no `taggedPlayerId`/`taggedScreenName` (the tagged
 * player is always the requester) and no `reportedByMe` — see
 * `ChallengeClipModal`'s comment for why that last omission rules out a
 * report control on that surface. */
export interface PendingChallengeEntry {
  clipId: string;
  uploaderPlayerId: string;
  uploaderScreenName: string;
  uploaderAvatarId: string;
  caption: string | null;
  playbackUrl: string;
  createdAt: string;
}

export interface PendingChallengesResponse {
  challenges: PendingChallengeEntry[];
}

export interface ChallengeAckResponse {
  clipId: string;
  acknowledged: true;
}

// --- Fas 8: PT (Personal Trainer) relationships -------------------------------
// docs/adr/0023-pt-role-and-staff-sso-rbac.md Part A,
// docs/design/phase8-pt-flows.md §7 (PL1) and §8 (CAP1).

/** Only the three states a player is ever shown — `declined`/`expired` are
 * filtered out server-side, deliberately (see the endpoint's own comment). */
export type PtConsentStatus = 'pending_review' | 'approved' | 'revoked';

/** PL1's row — the player's own view of one PT relationship. */
export interface PtConsentSummary {
  id: string;
  ptDisplayName: string;
  status: PtConsentStatus;
  decidedAt: string | null;
  revokedAt: string | null;
}

export type PtTeamLinkStatus = 'active' | 'revoked';

/** CAP1's row — one PT's link to the captain's own team. */
export interface PtTeamLinkRow {
  id: string;
  teamId: string;
  ptStaffAccountId: string;
  ptEmail: string;
  ptDisplayName: string | null;
  status: PtTeamLinkStatus;
  createdAt: string;
  revokedAt: string | null;
}

export interface PtTeamLinkInviteResult {
  code: string;
  expiresAt: string;
}

/** `cascadedConsentCount` is how many families' approved consents this
 * revoke just ended — CAP1 shows it in the confirmation, since that blast
 * radius is the whole reason that confirm is worded the way it is. */
export interface PtTeamLinkRevokeResult {
  revoked: true;
  cascadedConsentCount: number;
}

// --- Error envelope -----------------------------------------------------------

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

/**
 * A tip published by a trainer, as a player sees it.
 *
 * Deliberately carries no way to reach the author: a byline and nothing
 * else. Publishing TO children is a different thing from corresponding
 * WITH them, and only the first is on offer — see
 * backend/src/trainer-posts/trainer-feed.controller.ts.
 */
export interface TrainerPost {
  id: string;
  title: string;
  body: string;
  authorByline: string;
  locale: string;
  ageBand: string | null;
  focus: string | null;
  publishedAt: string | null;
}

/** ADR-0030 — the state of a player's own public-sharing permission. */
export interface PublicSharingStatus {
  /** Whether the feature exists for this player's team at all (the rollout
   * allow-list). False means show no share affordance — not a disabled
   * one — because there is nothing the child could do to change it. */
  available: boolean;
  /** Allow-list AND active parental consent, resolved server-side. */
  canShare: boolean;
  /** `none` deliberately covers declined, revoked and expired as well as
   * never-asked: from the child's screen these are one situation, and
   * telling a child their parent actively said no is a conversation for
   * the family rather than a status chip. */
  consent: 'none' | 'pending' | 'active';
}

export interface PublicSharingRequestResult {
  requested: true;
  expiresAt: string;
}

export interface ClipPublicationResult {
  clipId: string;
  publishedPublicly: boolean;
}
