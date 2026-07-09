// Request/response shapes mirroring docs/api/phase1-contract.md exactly.
// Keep in lockstep with that doc — this file has no logic, just shapes.

export type ConsentStatus =
  | 'not_requested'
  | 'pending'
  | 'approved'
  | 'revoked';

export type ActivityType = 'fitness' | 'drill' | 'running' | 'other';

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
}

export interface CreatePlayerResponse {
  playerId: string;
  teamId: string;
  screenName: string;
  avatarId: string;
  consentStatus: ConsentStatus;
  sessionToken: string;
}

// --- 3. POST /training-logs ---------------------------------------------------

export interface CreateTrainingLogRequest {
  activityType: ActivityType;
  durationMinutes: number;
  challengeId?: string;
}

export interface TrainingLogResponse {
  trainingLogId: string;
  loggedAt: string;
  streak: {
    currentStreakCount: number;
    longestStreakCount: number;
    alreadyLoggedToday: boolean;
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
  teamPool: {
    seasonId: string;
    seasonLabel: string;
    pointsTotal: number;
    status: string;
    rank?: number;
    teamCount?: number;
  };
}

// --- Phase 2 shapes, mirroring docs/api/phase2-contract.md exactly ---------
// Session-reissue/redeem (ADR-0004 Part 3) are deliberately NOT modeled
// here — both backend routes are disabled (503 `session_reissue_disabled`)
// pending a security redesign (docs/ACTION_PLAN.md Phase 2 follow-up), so
// there is no client function or type for them; building against a 503
// would be dead work.

export type WeeklyGoalStatus = 'draft' | 'active' | 'completed' | 'cancelled';

export type WeeklyGoalTargetMetric =
  | 'fitness-minuter'
  | 'drill-minuter'
  | 'running-minuter'
  | 'other-minuter'
  | 'total-minuter';

// --- 5. GET /teams/:teamId/dashboard ----------------------------------------

/** The dashboard's `weeklyGoal.current` block deliberately omits
 * `createdByPlayerId`/`teamId`/`bonusPointsAwarded` — matched exactly here
 * rather than as a superset of `GoalProgressSummary`, per the contract's own
 * note that this is intentional (endpoint 1's example), not an oversight. */
export interface DashboardCurrentGoal {
  id: string;
  title: string;
  description: string;
  targetMetric: WeeklyGoalTargetMetric;
  targetValue: number;
  startDate: string;
  endDate: string;
  status: WeeklyGoalStatus;
  progressMinutes: number;
  percentComplete: number;
  goalMet: boolean;
  bonusAwardedAt: string | null;
}

export interface TeamDashboardResponse {
  viewerIsCaptain: boolean;
  roster: {
    totalCount: number;
    approvedCount: number;
    pendingCount: number;
    revokedCount: number;
  };
  // Fas 2.7 (ADR-0008 Decision 4): goalThreshold/percentComplete removed,
  // rank/teamCount added — see the equivalent note on PlayerMeResponse
  // above (same optional-defensively rationale).
  teamPool: {
    seasonId: string;
    seasonLabel: string;
    pointsTotal: number;
    status: string;
    rank?: number;
    teamCount?: number;
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
  progressMinutes: number;
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

// --- Fas 2.6b shapes, mirroring docs/api/phase2.6b-contract.md exactly -----

export type ChatReportReason =
  | 'bullying'
  | 'inappropriate_language'
  | 'spam'
  | 'other';

/** endpoint 2, `GET .../chat/messages` row shape — also the shape of
 * endpoint 1's `POST .../chat/messages` response, minus `reportedByMe`
 * (a message the sender just posted couldn't have been reported by them
 * yet, so the client can safely default it to `false` locally). */
export interface ChatMessage {
  id: string;
  senderPlayerId: string;
  senderScreenName: string;
  senderAvatarId: string;
  content: string;
  createdAt: string;
  reportedByMe: boolean;
}

export interface ChatMessagesResponse {
  messages: ChatMessage[];
}

export interface PostChatMessageRequest {
  content: string;
}

export interface PostChatMessageResponse {
  id: string;
  teamId: string;
  senderPlayerId: string;
  senderScreenName: string;
  senderAvatarId: string;
  content: string;
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
  leaderboard: LeaderboardEntry[];
}

// --- Error envelope -----------------------------------------------------------

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
