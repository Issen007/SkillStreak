import { apiClient } from './client';
import type {
  ConsentReminderResponse,
  CreatePlayerRequest,
  CreatePlayerResponse,
  CreateTrainingLogRequest,
  CreateWeeklyGoalRequest,
  CurrentGoalResponse,
  GoalHistoryResponse,
  InvitePreviewResponse,
  PlayerMeResponse,
  TeamDashboardResponse,
  TeamRosterResponse,
  TrainingLogResponse,
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
