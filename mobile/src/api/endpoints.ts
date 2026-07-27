import { apiClient } from './client';
import type {
  BlockChatPlayerRequest,
  BlockChatPlayerResponse,
  CaptainTransferRequest,
  CaptainTransferResponse,
  ChatMessagesResponse,
  ClipsResponse,
  CompleteClipUploadResponse,
  ConsentReminderResponse,
  CreateClipUploadUrlRequest,
  CreateClipUploadUrlResponse,
  CreatePlayerRequest,
  CreatePlayerResponse,
  CreateTrainingLogRequest,
  CreateWeeklyGoalRequest,
  CurrentGoalResponse,
  DeleteClipResponse,
  GoalHistoryResponse,
  InvitePreviewResponse,
  LeaderboardResponse,
  PendingJoinsResponse,
  PlayerMeResponse,
  PostChatMessageRequest,
  PostChatMessageResponse,
  ReportChatMessageRequest,
  ReportChatMessageResponse,
  ReportClipRequest,
  ReportClipResponse,
  TeamDashboardResponse,
  TeamJoinDecisionResponse,
  TeammatesResponse,
  TeamRosterResponse,
  TrainingLogResponse,
  UnblockChatPlayerResponse,
  UpdateWeeklyGoalRequest,
  WeeklyGoalRow,
} from './types';

// The only four endpoints Phase 1's Expo app talks to, per
// docs/api/phase1-contract.md. Deliberately thin — no extra client-side
// endpoints invented beyond this contract.

/** 1. GET /teams/invite/:inviteCode — no auth. */
export function previewInvite(inviteCode: string): Promise<InvitePreviewResponse> {
  return apiClient.request<InvitePreviewResponse>(
    `/teams/invite/${encodeURIComponent(inviteCode)}`,
  );
}

/** 2. POST /players — no auth (creates the account + session token). */
export function createPlayer(
  body: CreatePlayerRequest,
): Promise<CreatePlayerResponse> {
  return apiClient.request<CreatePlayerResponse>('/players', {
    method: 'POST',
    body,
  });
}

/** 3. POST /training-logs — auth required. */
export function postTrainingLog(
  body: CreateTrainingLogRequest,
): Promise<TrainingLogResponse> {
  return apiClient.request<TrainingLogResponse>('/training-logs', {
    method: 'POST',
    body,
    auth: true,
  });
}

/** 4. GET /players/me — auth required. */
export function getMe(): Promise<PlayerMeResponse> {
  return apiClient.request<PlayerMeResponse>('/players/me', { auth: true });
}

// --- Phase 2 additions, per docs/api/phase2-contract.md ---------------------
// Session-reissue/redeem (ADR-0004 Part 3) are deliberately NOT added here —
// both backend routes are disabled (503 `session_reissue_disabled`) pending
// a security redesign; see docs/ACTION_PLAN.md's Phase 2 follow-ups.

/** 5. GET /teams/:teamId/dashboard — auth required; open to any teammate
 * (not captain-gated), per the contract. Backs Screen K1's baseline
 * content and captain-only card. */
export function getTeamDashboard(teamId: string): Promise<TeamDashboardResponse> {
  return apiClient.request<TeamDashboardResponse>(
    `/teams/${encodeURIComponent(teamId)}/dashboard`,
    { auth: true },
  );
}

/** 6. GET /teams/:teamId/roster — auth required, captain-gated server-side
 * (`403 not_team_captain`). Backs Screen K2 — the client only shows the
 * entry button when `viewerIsCaptain`, but this call is the real gate. */
export function getTeamRoster(teamId: string): Promise<TeamRosterResponse> {
  return apiClient.request<TeamRosterResponse>(
    `/teams/${encodeURIComponent(teamId)}/roster`,
    { auth: true },
  );
}

/** 7. POST /players/:playerId/consent-reminder — auth required, captain-
 * gated server-side. Backs Screen K2's row action. */
export function sendConsentReminder(playerId: string): Promise<ConsentReminderResponse> {
  return apiClient.request<ConsentReminderResponse>(
    `/players/${encodeURIComponent(playerId)}/consent-reminder`,
    { method: 'POST', auth: true },
  );
}

/** 8. POST /teams/:teamId/weekly-goal — auth required, captain-gated
 * server-side. Backs Screen KB4's "Spara som utkast"/"Aktivera nu". */
export function createWeeklyGoal(
  teamId: string,
  body: CreateWeeklyGoalRequest,
): Promise<WeeklyGoalRow> {
  return apiClient.request<WeeklyGoalRow>(
    `/teams/${encodeURIComponent(teamId)}/weekly-goal`,
    { method: 'POST', body, auth: true },
  );
}

/** 9. PATCH /teams/:teamId/weekly-goal/:id — auth required, captain-gated
 * server-side. Backs Screen KB4 (editing a draft) and Screen G1's
 * "Avbryt målet"/"Aktivera nu" captain actions. */
export function patchWeeklyGoal(
  teamId: string,
  goalId: string,
  body: UpdateWeeklyGoalRequest,
): Promise<WeeklyGoalRow> {
  return apiClient.request<WeeklyGoalRow>(
    `/teams/${encodeURIComponent(teamId)}/weekly-goal/${encodeURIComponent(goalId)}`,
    { method: 'PATCH', body, auth: true },
  );
}

/** 10. GET /teams/:teamId/weekly-goal — auth required; open to any
 * teammate. Backs Screen G1 and the G3 catch-up check. */
export function getWeeklyGoal(teamId: string): Promise<CurrentGoalResponse> {
  return apiClient.request<CurrentGoalResponse>(
    `/teams/${encodeURIComponent(teamId)}/weekly-goal`,
    { auth: true },
  );
}

/** 11. GET /teams/:teamId/weekly-goal/history — auth required; open to any
 * teammate. Backs G1's "Se tidigare mål" link. */
export function getWeeklyGoalHistory(teamId: string): Promise<GoalHistoryResponse> {
  return apiClient.request<GoalHistoryResponse>(
    `/teams/${encodeURIComponent(teamId)}/weekly-goal/history`,
    { auth: true },
  );
}

// --- Fas 2.6a additions, per docs/adr/0006-captain-transfer.md's endpoints -

/** 9 (addendum). POST /teams/:teamId/captain-transfer — auth required,
 * captain-gated server-side (`403 not_team_captain`). Backs Screen K4's
 * confirm sheet. */
export function transferCaptaincy(
  teamId: string,
  body: CaptainTransferRequest,
): Promise<CaptainTransferResponse> {
  return apiClient.request<CaptainTransferResponse>(
    `/teams/${encodeURIComponent(teamId)}/captain-transfer`,
    { method: 'POST', body, auth: true },
  );
}

/** 10 (addendum). GET /teams/:teamId/teammates — auth required; open to
 * any teammate (not captain-gated). Backs Screen K1's baseline "Spelare i
 * laget" section and Screen K4's transfer-target list. */
export function getTeammates(teamId: string): Promise<TeammatesResponse> {
  return apiClient.request<TeammatesResponse>(
    `/teams/${encodeURIComponent(teamId)}/teammates`,
    { auth: true },
  );
}

// --- Fas 4 additions: captain approval for new team joins -------------------
// docs/adr/0009-self-service-team-creation.md's 2026-07-27 addendum.

/** GET /teams/:teamId/pending-joins — auth required, captain-gated
 * server-side (`403 not_team_captain`). Backs Laget's "Väntar på
 * godkännande" section. */
export function getPendingJoins(teamId: string): Promise<PendingJoinsResponse> {
  return apiClient.request<PendingJoinsResponse>(
    `/teams/${encodeURIComponent(teamId)}/pending-joins`,
    { auth: true },
  );
}

/** POST /teams/:teamId/pending-joins/:playerId/approve — captain-gated. */
export function approveTeamJoin(
  teamId: string,
  playerId: string,
): Promise<TeamJoinDecisionResponse> {
  return apiClient.request<TeamJoinDecisionResponse>(
    `/teams/${encodeURIComponent(teamId)}/pending-joins/${encodeURIComponent(playerId)}/approve`,
    { method: 'POST', auth: true },
  );
}

/** POST /teams/:teamId/pending-joins/:playerId/reject — captain-gated. */
export function rejectTeamJoin(
  teamId: string,
  playerId: string,
): Promise<TeamJoinDecisionResponse> {
  return apiClient.request<TeamJoinDecisionResponse>(
    `/teams/${encodeURIComponent(teamId)}/pending-joins/${encodeURIComponent(playerId)}/reject`,
    { method: 'POST', auth: true },
  );
}

// --- Fas 2.6b additions, per docs/api/phase2.6b-contract.md ----------------

/** 1. POST /teams/:teamId/chat/messages — auth required, consent-gated
 * (`403 consent_required`), moderation-gated (`422
 * message_rejected_by_filter`), rate-limited (`429
 * chat_send_rate_limited`). Backs Screen CH1's compose box. */
export function postChatMessage(
  teamId: string,
  body: PostChatMessageRequest,
): Promise<PostChatMessageResponse> {
  return apiClient.request<PostChatMessageResponse>(
    `/teams/${encodeURIComponent(teamId)}/chat/messages`,
    { method: 'POST', body, auth: true },
  );
}

/** 2. GET /teams/:teamId/chat/messages — auth required; no consent gate on
 * reading. `after`/`limit` per the contract — no backward pagination
 * exists (deliberate, see the flow doc's judgment call 11). Backs Screen
 * CH1's initial fetch and its ~5s poll while focused. */
export function getChatMessages(
  teamId: string,
  params?: { after?: string; limit?: number },
): Promise<ChatMessagesResponse> {
  const query = new URLSearchParams();
  if (params?.after) query.set('after', params.after);
  if (params?.limit) query.set('limit', String(params.limit));
  const queryString = query.toString();
  return apiClient.request<ChatMessagesResponse>(
    `/teams/${encodeURIComponent(teamId)}/chat/messages${queryString ? `?${queryString}` : ''}`,
    { auth: true },
  );
}

/** 3. POST /teams/:teamId/chat/messages/:messageId/report — auth required;
 * any player, no privileged reporter role. Backs Screen CH2's submit. */
export function reportChatMessage(
  teamId: string,
  messageId: string,
  body: ReportChatMessageRequest,
): Promise<ReportChatMessageResponse> {
  return apiClient.request<ReportChatMessageResponse>(
    `/teams/${encodeURIComponent(teamId)}/chat/messages/${encodeURIComponent(messageId)}/report`,
    { method: 'POST', body, auth: true },
  );
}

/** 4. POST /teams/:teamId/chat/blocks — auth required, idempotent. Backs
 * Screen CH4's "Blockera {screenName}" confirm. */
export function blockChatPlayer(
  teamId: string,
  body: BlockChatPlayerRequest,
): Promise<BlockChatPlayerResponse> {
  return apiClient.request<BlockChatPlayerResponse>(
    `/teams/${encodeURIComponent(teamId)}/chat/blocks`,
    { method: 'POST', body, auth: true },
  );
}

/** 5. DELETE /teams/:teamId/chat/blocks/:blockedPlayerId — auth required,
 * idempotent unblock. Backs Screen CH5's "Sluta blockera" row action. */
export function unblockChatPlayer(
  teamId: string,
  blockedPlayerId: string,
): Promise<UnblockChatPlayerResponse> {
  return apiClient.request<UnblockChatPlayerResponse>(
    `/teams/${encodeURIComponent(teamId)}/chat/blocks/${encodeURIComponent(blockedPlayerId)}`,
    { method: 'DELETE', auth: true },
  );
}

// --- Fas 2.7 additions, per docs/api/phase2.7-contract.md -------------------

/** GET /teams/:teamId/leaderboard — auth required; open to any teammate.
 * Backs Screen LB2, reached by tapping the rewritten `TeamPoolCard`
 * (Screen LB1) from either Home or "Laget". */
export function getLeaderboard(teamId: string): Promise<LeaderboardResponse> {
  return apiClient.request<LeaderboardResponse>(
    `/teams/${encodeURIComponent(teamId)}/leaderboard`,
    { auth: true },
  );
}

// --- Fas 3 additions, per docs/api/phase3-contract.md -----------------------
// The "Klipp" tab's five endpoints. Consent-gates both writes *and* reads
// (unlike chat) — see `ClipsScreen`'s whole-tab waiting state for the read
// side of that.

/** 1. POST /teams/:teamId/clips/upload-url — auth required, consent-gated,
 * rate-limited (`429 clip_upload_rate_limited`), caption moderation-gated
 * (`422 caption_rejected_by_filter`). Backs Screen V5's "Ladda upp" —
 * step 1 of the two-phase upload; the client `PUT`s bytes to the returned
 * `uploadUrl` directly (never through this API), then calls
 * `completeClipUpload` (step 2). Never skip step 2. */
export function createClipUploadUrl(
  teamId: string,
  body: CreateClipUploadUrlRequest,
): Promise<CreateClipUploadUrlResponse> {
  return apiClient.request<CreateClipUploadUrlResponse>(
    `/teams/${encodeURIComponent(teamId)}/clips/upload-url`,
    { method: 'POST', body, auth: true },
  );
}

/** 2. POST /teams/:teamId/clips/:clipId/complete — auth required, step 2 of
 * the two-phase upload (Screen V6). `409 upload_not_found`/`422
 * clip_processing_failed` both mean "retry from step 1 with a fresh
 * `clipId`", per the contract — never retry `complete` again for the same
 * clip. */
export function completeClipUpload(
  teamId: string,
  clipId: string,
): Promise<CompleteClipUploadResponse> {
  return apiClient.request<CompleteClipUploadResponse>(
    `/teams/${encodeURIComponent(teamId)}/clips/${encodeURIComponent(clipId)}/complete`,
    { method: 'POST', auth: true },
  );
}

/** 3. GET /teams/:teamId/clips — auth required, consent-gated (`403
 * consent_required` on the read itself, not just upload — Screen V1 occupies
 * the whole tab for this, per the contract's stricter-than-chat posture).
 * `before`/`limit` back Screen V2's explicit "Visa fler klipp" pagination —
 * deliberately never auto-fetched on scroll (see the flow doc's judgment
 * call 3). */
export function getClips(
  teamId: string,
  params?: { before?: string; limit?: number },
): Promise<ClipsResponse> {
  const query = new URLSearchParams();
  if (params?.before) query.set('before', params.before);
  if (params?.limit) query.set('limit', String(params.limit));
  const queryString = query.toString();
  return apiClient.request<ClipsResponse>(
    `/teams/${encodeURIComponent(teamId)}/clips${queryString ? `?${queryString}` : ''}`,
    { auth: true },
  );
}

/** 4. DELETE /teams/:teamId/clips/:clipId — auth required, uploader-only
 * (`403 not_your_clip`), no consent gate (removing your own content is
 * always allowed). Backs Screen V11's "Ja, ta bort klippet". */
export function deleteClip(teamId: string, clipId: string): Promise<DeleteClipResponse> {
  return apiClient.request<DeleteClipResponse>(
    `/teams/${encodeURIComponent(teamId)}/clips/${encodeURIComponent(clipId)}`,
    { method: 'DELETE', auth: true },
  );
}

/** 5. POST /teams/:teamId/clips/:clipId/report — auth required,
 * consent-gated, any teammate. Backs Screen V9's "Skicka rapport" — per
 * ADR-0010 Decision 4, a `201` here immediately hides the clip for the
 * whole team, including the reporter (Screen V10's copy states this
 * plainly). */
export function reportClip(
  teamId: string,
  clipId: string,
  body: ReportClipRequest,
): Promise<ReportClipResponse> {
  return apiClient.request<ReportClipResponse>(
    `/teams/${encodeURIComponent(teamId)}/clips/${encodeURIComponent(clipId)}/report`,
    { method: 'POST', body, auth: true },
  );
}
