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
  teamPool: {
    pointsTotal: number;
    goalThreshold: number;
    percentComplete: number;
  };
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
    lastTrainedDate: string | null;
    alreadyLoggedToday: boolean;
  };
  teamPool: {
    seasonId: string;
    seasonLabel: string;
    pointsTotal: number;
    goalThreshold: number;
    percentComplete: number;
    status: string;
  };
}

// --- Error envelope -----------------------------------------------------------

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
