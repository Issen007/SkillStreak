import { apiClient } from './client';
import type {
  CreatePlayerRequest,
  CreatePlayerResponse,
  CreateTrainingLogRequest,
  InvitePreviewResponse,
  PlayerMeResponse,
  TrainingLogResponse,
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
