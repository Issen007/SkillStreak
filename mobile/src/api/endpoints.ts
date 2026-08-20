import { apiClient } from './client';
import type {
  BlockChatPlayerRequest,
  BlockChatPlayerResponse,
  CancelErasureResponse,
  CaptainTransferRequest,
  CaptainTransferResponse,
  ChallengeAckResponse,
  ChatMessagesResponse,
  ClipPublicationResult,
  ClipsResponse,
  CompleteClipUploadResponse,
  ConsentReminderResponse,
  CreateClipUploadUrlRequest,
  CreateClipUploadUrlResponse,
  CreatePlayerRequest,
  CreatePlayerResponse,
  CreateTrainingLogRequest,
  ConfirmContactChangeRequest,
  ConfirmContactChangeResponse,
  CreateWeeklyGoalRequest,
  CurrentGoalResponse,
  DeleteClipResponse,
  ErasureStatusResponse,
  GoalHistoryResponse,
  InvitePreviewResponse,
  LeaderboardResponse,
  PendingChallengesResponse,
  PendingJoinsResponse,
  PlayerMeResponse,
  PlayerProfileResponse,
  PostChatMessageRequest,
  PostChatMessageResponse,
  RedeemSessionResponse,
  ReportChatMessageRequest,
  ReportChatMessageResponse,
  PublicSharingRequestResult,
  PublicSharingStatus,
  ReportClipRequest,
  ReportClipResponse,
  RequestContactChangeRequest,
  RequestContactChangeResponse,
  RequestErasureRequest,
  RequestErasureResponse,
  RequestSessionReissueRequest,
  SessionReissueSelfServiceResponse,
  SessionReissueTriggerResponse,
  TeamDashboardResponse,
  TeamJoinDecisionResponse,
  TeammatesResponse,
  TeamRosterResponse,
  TrainingLogResponse,
  UnblockChatPlayerResponse,
  UpdateProfileRequest,
  UpdateWeeklyGoalRequest,
  WeeklyGoalRow,
  PtConsentSummary,
  PtTeamLinkInviteResult,
  PtTeamLinkRevokeResult,
  PtTeamLinkRow,
  TrainerPost,
  SubmitBugReportRequest,
  SubmitBugReportResponse,
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

// Session-reissue/redeem (ADR-0004 Part 3), redesigned per that ADR's
// 2026-07-27 addendum — "new device login." Two trigger surfaces
// (self-service, captain-triggered) plus the shared redeem step; none of
// these ever see the reissue code itself, it's emailed to the player's
// own parent_contact.

/** No auth — "Har du redan ett konto?" on the onboarding entry point.
 * Always resolves with the same generic { requested: true } shape,
 * whether or not inviteCode/screenName matched anything — see
 * SessionService.requestReissueSelfService's own comment. */
export function requestSessionReissue(
  body: RequestSessionReissueRequest,
): Promise<SessionReissueSelfServiceResponse> {
  return apiClient.request<SessionReissueSelfServiceResponse>(
    '/players/session/reissue-request',
    { method: 'POST', body },
  );
}

/** No auth — the caller has no valid session by definition. Redeems a
 * code (from either trigger surface above) for a fresh session token. */
export function redeemSessionCode(code: string): Promise<RedeemSessionResponse> {
  return apiClient.request<RedeemSessionResponse>('/players/session/redeem', {
    method: 'POST',
    body: { code },
  });
}

/** Auth required, captain-only (service-layer check against the target's
 * team) — the roster's "Skicka ny inloggningslänk" action. Response never
 * contains the code (see the ADR addendum); the UI's job is just to
 * confirm the request went out; token_version bumps immediately either
 * way. */
export function triggerSessionReissue(
  playerId: string,
): Promise<SessionReissueTriggerResponse> {
  return apiClient.request<SessionReissueTriggerResponse>(
    `/players/${encodeURIComponent(playerId)}/session-reissue`,
    { method: 'POST', auth: true },
  );
}

// docs/adr/0012-profile-page-and-contact-email-change.md (Fas 4.1) — the
// profile page. All four require auth and operate on the caller's own
// account (`/players/me/...`, no playerId param).

export function getProfile(): Promise<PlayerProfileResponse> {
  return apiClient.request<PlayerProfileResponse>('/players/me/profile', {
    auth: true,
  });
}

export function updateProfile(
  body: UpdateProfileRequest,
): Promise<{ updated: true }> {
  return apiClient.request<{ updated: true }>('/players/me/profile', {
    method: 'PATCH',
    body,
    auth: true,
  });
}

/** Never returns the code — it's emailed to the new address, and a
 * notification (no code) goes to the old one. See the ADR for why. */
export function requestContactChange(
  body: RequestContactChangeRequest,
): Promise<RequestContactChangeResponse> {
  return apiClient.request<RequestContactChangeResponse>(
    '/players/me/contact-change-request',
    { method: 'POST', body, auth: true },
  );
}

export function confirmContactChange(
  body: ConfirmContactChangeRequest,
): Promise<ConfirmContactChangeResponse> {
  return apiClient.request<ConfirmContactChangeResponse>(
    '/players/me/contact-change-confirm',
    { method: 'POST', body, auth: true },
  );
}

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
 * laget" section and Screen K4's transfer-target list.
 *
 * `approvedOnly` (ADR-0021's security-reviewer addendum finding 2) is
 * opt-in per call site, never a default: this one endpoint backs three
 * independent pickers — the clip tag picker, the captain-transfer picker
 * and the GDPR erasure successor picker — and only the first one wants a
 * still-PENDING joiner hidden. Pass it there and nowhere else. */
export function getTeammates(
  teamId: string,
  options: { approvedOnly?: boolean } = {},
): Promise<TeammatesResponse> {
  const query = options.approvedOnly ? '?approvedOnly=true' : '';
  return apiClient.request<TeammatesResponse>(
    `/teams/${encodeURIComponent(teamId)}/teammates${query}`,
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
  /** Background upload: the caption and tag are written here rather than at
   * upload-url time, because the bytes start moving before the player has
   * typed anything. Omit both on the original flow. An explicit `null`
   * clears a value set at create time; `undefined` keeps it. */
  metadata: { caption?: string | null; taggedPlayerId?: string | null } = {},
): Promise<CompleteClipUploadResponse> {
  return apiClient.request<CompleteClipUploadResponse>(
    `/teams/${encodeURIComponent(teamId)}/clips/${encodeURIComponent(clipId)}/complete`,
    { method: 'POST', body: metadata, auth: true },
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

// --- Fas 4.2 additions, per docs/adr/0013-account-erasure.md Decision 3 ----
// (self-service GDPR account erasure). All three require auth and operate on
// the caller's own account (`/players/me/...`, no playerId param). The two
// unauthenticated confirm/cancel-by-code routes are plain HTML pages the
// mailed link opens directly (backend-developer's job, not an in-app
// screen) — no client function for those two.

/** Screen E4's confirm sheet — the bare in-app tap this creates does
 * nothing durable on its own (Decision 2): the 30-day clock only starts
 * once the mailed confirm code is redeemed. */
export function requestErasure(
  body: RequestErasureRequest,
): Promise<RequestErasureResponse> {
  return apiClient.request<RequestErasureResponse>('/players/me/erasure/request', {
    method: 'POST',
    body,
    auth: true,
  });
}

/** Backs Screen E1/E6 — fetched alongside `getProfile()` on every Profile
 * screen load (`Promise.all`, not a second round-trip), per the flow doc. */
export function getErasureStatus(): Promise<ErasureStatusResponse> {
  return apiClient.request<ErasureStatusResponse>('/players/me/erasure/status', {
    auth: true,
  });
}

/** Screen E6's "Ångra begäran"/"Ångra raderingen" action — the
 * authenticated, PRIMARY cancel path (Decision 7); the mailed cancel link
 * is a backup, not called from the app. */
export function cancelErasure(): Promise<CancelErasureResponse> {
  return apiClient.request<CancelErasureResponse>('/players/me/erasure/cancel', {
    method: 'POST',
    auth: true,
  });
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

// --- Fas 4.6 additions, per docs/adr/0021-clip-challenge-notifications.md --
// Decision 1's two new clip-challenge endpoints, backing Laget's
// "Utmaningar till dig" section (docs/design/clip-challenge-notifications-ui.md
// §1). Both are team-scoped and auth-required, same shape as the five clip
// endpoints above.

/** GET /teams/:teamId/clips/challenges/pending — auth required, and gated
 * exactly like `getClips` (`403` for a not-yet-consent/join-approved
 * requester). Every player, not captain-gated. Unacknowledged, published,
 * tagged-at-me clips only; no pagination (bounded by team size). */
export function getPendingClipChallenges(teamId: string): Promise<PendingChallengesResponse> {
  return apiClient.request<PendingChallengesResponse>(
    `/teams/${encodeURIComponent(teamId)}/clips/challenges/pending`,
    { auth: true },
  );
}

/** POST /teams/:teamId/clips/:clipId/challenge-ack — tagged-player-only
 * (`403 not_your_challenge`), idempotent: re-acking an already-acked
 * challenge is a `200` no-op, so both the "watch" and the "Redan sett"
 * trigger can fire it freely without coordinating. */
export function ackClipChallenge(
  teamId: string,
  clipId: string,
): Promise<ChallengeAckResponse> {
  return apiClient.request<ChallengeAckResponse>(
    `/teams/${encodeURIComponent(teamId)}/clips/${encodeURIComponent(clipId)}/challenge-ack`,
    { method: 'POST', auth: true },
  );
}

// --- Fas 8: PT relationships --------------------------------------------------
// docs/adr/0023-pt-role-and-staff-sso-rbac.md Part A. All five are
// player-authenticated; the two team-link writes are additionally
// captain-checked server-side (`assertIsCaptainOfTeam` inside the service,
// no client-side gate to keep in sync).

/** PL1 — the player's own PT relationships. Own rows only; there is no id
 * in the request to tamper with. */
export function getMyPtConsents(): Promise<PtConsentSummary[]> {
  return apiClient.request<PtConsentSummary[]>('/players/me/pt-consents', {
    auth: true,
  });
}

/** ADR-0023 Decision A4 lever 1 — the child's own, immediate, no-parent-
 * needed exit. Deliberately lower friction than granting ever was. */
/**
 * Published trainer tips. Adult-authored, admin-reviewed before anything
 * appears here.
 *
 * No parameters that identify the reader, by design: the same posts go to
 * everyone, so the server learns nothing about who asked beyond the auth
 * it already has.
 */
export function getTrainerFeed(): Promise<TrainerPost[]> {
  return apiClient.request<TrainerPost[]>('/feed/trainer-posts', {
    auth: true,
  });
}

export function revokeMyPtConsent(consentId: string): Promise<{ revoked: true }> {
  return apiClient.request<{ revoked: true }>(
    `/players/me/pt-consents/${encodeURIComponent(consentId)}/revoke`,
    { method: 'POST', auth: true },
  );
}

/** CAP1 — the captain's view of who is linked to their team. */
export function getTeamPtLinks(teamId: string): Promise<PtTeamLinkRow[]> {
  return apiClient.request<PtTeamLinkRow[]>(
    `/teams/${encodeURIComponent(teamId)}/pt-links`,
    { auth: true },
  );
}

export function createTeamPtInvite(
  teamId: string,
): Promise<PtTeamLinkInviteResult> {
  return apiClient.request<PtTeamLinkInviteResult>(
    `/teams/${encodeURIComponent(teamId)}/pt-links/invite`,
    { method: 'POST', auth: true },
  );
}

/** ADR-0023 Decision A4 lever 3 — cascades to every family's consent under
 * this link, in one transaction. See CAP1's confirm copy. */
export function revokeTeamPtLink(
  teamId: string,
  linkId: string,
): Promise<PtTeamLinkRevokeResult> {
  return apiClient.request<PtTeamLinkRevokeResult>(
    `/teams/${encodeURIComponent(teamId)}/pt-links/${encodeURIComponent(linkId)}/revoke`,
    { method: 'POST', auth: true },
  );
}

// --- ADR-0030: sharing a clip outside the team ---------------------------
//
// Three gates stand between a child and a public clip, and the app is only
// allowed to know the *answer*, never to reconstruct the reasoning: the
// team must be in the rollout allow-list, the child's parent must have an
// active consent, and the child must choose the individual clip. The first
// two collapse into `canShare` server-side deliberately — the rule lives in
// one place, not in two that can drift.

/** GET /me/public-sharing — auth required. Cheap; safe to call on focus. */
export function getPublicSharingStatus(): Promise<PublicSharingStatus> {
  return apiClient.request<PublicSharingStatus>('/me/public-sharing', {
    method: 'GET',
    auth: true,
  });
}

/** POST /me/public-sharing/request — auth required. Emails the parent an
 * approval link. Returns only that it was sent and when the link dies; the
 * code itself never reaches the app, which is the single property that
 * makes a mailed consent mean anything. Rate limited server-side (5/hour,
 * plus a 15-minute cooldown and 3/day cap under it) — a `429` here is
 * expected, not exceptional, and the UI should say "check the inbox"
 * rather than retry. */
export function requestPublicSharing(): Promise<PublicSharingRequestResult> {
  return apiClient.request<PublicSharingRequestResult>(
    '/me/public-sharing/request',
    { method: 'POST', auth: true },
  );
}

/** POST /clips/:clipId/public — auth required. Fails with
 * `public_sharing_not_consented` if the parent has revoked since the app
 * last checked, which is why the button re-reads status on failure rather
 * than trusting the cached `canShare`. */
export function publishClipPublicly(
  clipId: string,
): Promise<ClipPublicationResult> {
  return apiClient.request<ClipPublicationResult>(
    `/clips/${encodeURIComponent(clipId)}/public`,
    { method: 'POST', auth: true },
  );
}

/** DELETE /clips/:clipId/public — auth required, and deliberately gated on
 * nothing but ownership. Taking a clip down must never be blocked by the
 * things that gate putting it up: a parent who has just revoked is exactly
 * the case where removal matters most. */
export function unpublishClipPublicly(
  clipId: string,
): Promise<ClipPublicationResult> {
  return apiClient.request<ClipPublicationResult>(
    `/clips/${encodeURIComponent(clipId)}/public`,
    { method: 'DELETE', auth: true },
  );
}

/** Screen BR2's Skicka — docs/design/phase7-admin-console-flows.md §9.
 *
 * Auth required but deliberately NOT consent-gated: a child whose parental
 * consent is still pending is the person most likely to have something
 * worth reporting, and the endpoint is specified as plain `JwtAuthGuard`
 * for exactly that reason. 201 on success; `bug_report_rate_limited` / 429
 * is the one error the UI branches on by code. */
export function submitBugReport(
  body: SubmitBugReportRequest,
): Promise<SubmitBugReportResponse> {
  return apiClient.request<SubmitBugReportResponse>('/bug-reports', {
    method: 'POST',
    body,
    auth: true,
  });
}
