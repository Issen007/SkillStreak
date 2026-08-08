import { HttpStatus } from '@nestjs/common';
import { AppException } from './app.exception';

export class InviteCodeNotFoundException extends AppException {
  constructor() {
    super(
      'invite_code_not_found',
      // Deliberately generic per the contract — doesn't confirm/deny
      // whether a code is "close" to a valid one.
      'No team found for this invite code.',
      HttpStatus.NOT_FOUND,
    );
  }
}

export class ScreenNameTakenException extends AppException {
  constructor() {
    super(
      'screen_name_taken_in_team',
      'That screen name is already used within this team.',
      HttpStatus.CONFLICT,
    );
  }
}

export class ConsentRequiredException extends AppException {
  constructor() {
    super(
      'consent_required',
      'Parental consent is pending or not requested.',
      HttpStatus.FORBIDDEN,
    );
  }
}

export class UnauthorizedTokenException extends AppException {
  constructor(message = 'Missing or invalid bearer token.') {
    super('unauthorized', message, HttpStatus.UNAUTHORIZED);
  }
}

export class PlayerNotFoundException extends AppException {
  constructor() {
    // Only reachable if a validly-signed JWT points at a player that no
    // longer exists (e.g. deleted) — an operational edge case, not a normal
    // client-input error, but still surfaced with a stable code.
    super('player_not_found', 'Player not found.', HttpStatus.NOT_FOUND);
  }
}

// --- Phase 2 (Kapten & the weekly team goal) -------------------------------
// docs/adr/0005-kapten-and-weekly-team-goal.md /
// docs/api/phase2-contract.md.

export class TeamMismatchException extends AppException {
  constructor() {
    super(
      'team_mismatch',
      'The requesting player does not belong to this team.',
      HttpStatus.FORBIDDEN,
    );
  }
}

export class NotTeamCaptainException extends AppException {
  constructor() {
    super(
      'not_team_captain',
      "This action requires the requesting player to be their team's captain.",
      HttpStatus.FORBIDDEN,
    );
  }
}

export class ChallengeNotFoundException extends AppException {
  constructor() {
    super(
      'challenge_not_found',
      'Weekly goal not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}

export class ActiveGoalAlreadyExistsException extends AppException {
  constructor() {
    super(
      'active_goal_already_exists',
      'This team already has an active weekly goal.',
      HttpStatus.CONFLICT,
    );
  }
}

export class InvalidChallengeTransitionException extends AppException {
  constructor() {
    super(
      'invalid_challenge_transition',
      'That status transition is not allowed for a weekly goal.',
      HttpStatus.CONFLICT,
    );
  }
}

export class ChallengeTargetFrozenException extends AppException {
  constructor() {
    super(
      'challenge_target_frozen',
      'targetMetric/targetValue/startDate/endDate are frozen once a weekly goal leaves draft.',
      HttpStatus.CONFLICT,
    );
  }
}

export class ChallengeAlreadyTerminalException extends AppException {
  constructor() {
    // Fixes a confirmed code-critic finding: title/description were being
    // applied unconditionally, with no check against currentStatus at all
    // — contradicting both ADR-0005 and phase2-contract.md's "editable at
    // any non-terminal status." completed/cancelled goals are now a
    // read-only historical record in full, not just for their
    // target/dates.
    super(
      'challenge_already_terminal',
      'title/description cannot be edited once a weekly goal is completed or cancelled.',
      HttpStatus.CONFLICT,
    );
  }
}

export class ConsentNotPendingException extends AppException {
  constructor() {
    super(
      'consent_not_pending',
      'A consent reminder can only be sent while consent is pending.',
      HttpStatus.CONFLICT,
    );
  }
}

export class ConsentReminderRateLimitedException extends AppException {
  constructor() {
    super(
      'consent_reminder_rate_limited',
      'A consent reminder was already sent recently for this player; try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export class InvalidOrExpiredCodeException extends AppException {
  constructor() {
    // Deliberately generic per ADR-0004 Part 3 — doesn't distinguish
    // "no such code" from "expired" from "already used".
    super(
      'invalid_or_expired_code',
      'This session-reissue code is invalid, expired, or already used.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

// --- Fas 2.6a (captain transfer) -------------------------------------------
// docs/adr/0006-captain-transfer.md / docs/api/phase2-contract.md's
// 2026-07-08 addendum.

export class CaptainTransferToSelfException extends AppException {
  constructor() {
    super(
      'captain_transfer_target_is_self',
      'newCaptainPlayerId must be a different player than the requesting captain.',
      HttpStatus.CONFLICT,
    );
  }
}

export class CaptainTransferTargetNotOnTeamException extends AppException {
  constructor() {
    super(
      'captain_transfer_target_not_on_team',
      'newCaptainPlayerId exists but does not belong to this team.',
      HttpStatus.FORBIDDEN,
    );
  }
}

export class CaptainTransferConflictException extends AppException {
  constructor() {
    // Defensive backstop for idx_player_one_captain_per_team — should be
    // unreachable given transferCaptaincy's row locks (see ADR-0006), kept
    // for the same reason WeeklyGoalService catches the equivalent
    // violation for idx_challenge_one_active_goal_per_team.
    super(
      'captain_transfer_conflict',
      'Captain transfer could not be completed due to a concurrent update.',
      HttpStatus.CONFLICT,
    );
  }
}

// --- Fas 2.6b (team chat) ---------------------------------------------------
// docs/adr/0007-team-chat.md / docs/api/phase2.6b-contract.md.

export class ChatMessageRejectedByFilterException extends AppException {
  constructor() {
    super(
      'message_rejected_by_filter',
      'Message contains a disallowed term.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class ChatSendRateLimitedException extends AppException {
  constructor() {
    super(
      'chat_send_rate_limited',
      'Too many chat messages sent recently; try again shortly.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export class ChatMessageNotFoundException extends AppException {
  constructor() {
    super(
      'chat_message_not_found',
      'No such chat message on this team.',
      HttpStatus.NOT_FOUND,
    );
  }
}

export class ChatMessageAlreadyReportedException extends AppException {
  constructor() {
    super(
      'chat_message_already_reported_by_you',
      'You have already reported this message.',
      HttpStatus.CONFLICT,
    );
  }
}

export class ChatReportRateLimitedException extends AppException {
  constructor() {
    super(
      'chat_report_rate_limited',
      'Too many reports submitted recently; try again shortly.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

// --- Fas 2.9 (self-service team creation) -----------------------------------
// docs/adr/0009-self-service-team-creation.md /
// docs/api/phase1-contract.md's 2026-07-09 addendum.

export class TeamNameRejectedByFilterException extends AppException {
  constructor() {
    // Mirrors ChatMessageRejectedByFilterException's shape (ADR-0009
    // Decision 5) — thrown whether the team *name* or the (also-checked,
    // per ACTION_PLAN.md's Phase 2.9 decision) invite *code* fails the
    // filter; the contract doesn't need to distinguish which field failed.
    super(
      'team_name_rejected_by_filter',
      'Team name (or invite code) contains a disallowed term.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class InviteCodeTakenConcurrentlyException extends AppException {
  constructor() {
    // ADR-0009 Decision 8 — an explicit error, not a silent fallback to
    // joining the team the other request just created: two onboarding
    // sessions raced to create a team with the identical not-yet-existing
    // invite code, and this request lost.
    super(
      'invite_code_taken_concurrently',
      'Another request just created a team with this invite code; please check the code again.',
      HttpStatus.CONFLICT,
    );
  }
}

export class CaptainConsentRequiredException extends AppException {
  constructor() {
    // Decided in docs/ACTION_PLAN.md's Phase 2.9 section, prompted by
    // ADR-0009's flagged risk #1: a self-created team's captain can exist
    // with their own parental consent still pending (unlike every prior
    // captain — seed-created or ADR-0006-transferred — whose consent was
    // always already approved by construction). Every captain-gated action
    // (PlayersService.assertIsCaptainOfTeam and the inline check in
    // transferCaptaincy) now also requires the *acting* captain's own
    // parentalConsentStatus === approved, not just the isCaptain flag and
    // team membership. Distinct from the generic ConsentRequiredException
    // (used for training-log/chat-send) so a client can tell "you're not
    // captain" apart from "you're captain but your own consent isn't
    // approved yet".
    super(
      'captain_consent_required',
      "This action requires the acting captain's own parental consent to be approved.",
      HttpStatus.FORBIDDEN,
    );
  }
}

// --- Fas 3 (video clips & the team feed) ------------------------------------
// docs/adr/0010-video-storage-and-serving.md / docs/api/phase3-contract.md.

export class ClipUploadRateLimitedException extends AppException {
  constructor() {
    super(
      'clip_upload_rate_limited',
      'Too many clip uploads started recently; try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export class CaptionRejectedByFilterException extends AppException {
  constructor() {
    // Same shape as ChatMessageRejectedByFilterException — reuses
    // ChatModerationCheck (docs/api/phase3-contract.md endpoint 1).
    super(
      'caption_rejected_by_filter',
      'Caption contains a disallowed term.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class ClipNotFoundException extends AppException {
  constructor() {
    // Deliberately generic per the contract — covers "no such clipId",
    // "not on this team", "not owned by this uploader" and (for `complete`)
    // "not in pending_upload state" without distinguishing which, same
    // posture as ChatMessageNotFoundException.
    super(
      'clip_not_found',
      'No such video clip for this team/uploader (or not in the expected state).',
      HttpStatus.NOT_FOUND,
    );
  }
}

export class UploadNotFoundException extends AppException {
  constructor() {
    // docs/api/phase3-contract.md endpoint 2 — the HEAD check against MinIO
    // found nothing within the presigned PUT's validity window. Client
    // should retry from endpoint 1 with a fresh clipId, not retry `complete`
    // for this one.
    super(
      'upload_not_found',
      'The uploaded object was not found in storage — retry the upload from a fresh upload-url request.',
      HttpStatus.CONFLICT,
    );
  }
}

export class ClipProcessingFailedException extends AppException {
  constructor() {
    // ADR-0010 Decision 3 (blocking, security-reviewer finding) — the
    // mandatory metadata-stripping remux failed. The clip stays
    // pending_upload; it is never published unstripped.
    super(
      'clip_processing_failed',
      'The uploaded clip could not be processed (metadata-stripping failed) and was not published.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class NotYourClipException extends AppException {
  constructor() {
    super(
      'not_your_clip',
      'Only the uploader can perform this action on a clip.',
      HttpStatus.FORBIDDEN,
    );
  }
}

export class ClipAlreadyReportedException extends AppException {
  constructor() {
    super(
      'clip_already_reported_by_you',
      'You have already reported this clip.',
      HttpStatus.CONFLICT,
    );
  }
}

export class ClipReportRateLimitedException extends AppException {
  constructor() {
    super(
      'clip_report_rate_limited',
      'Too many reports submitted recently; try again shortly.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

// --- Fas 4 (captain approval for new team joins) ----------------------------
// Added 2026-07-27: joining an existing team via invite code used to be
// immediate — anyone with the code was a full member on the spot. A
// captain now has to approve each new join before it counts, mirroring
// how parental consent already gates gameplay (a second, independent
// gate, not a replacement for it).

export class TeamJoinApprovalRequiredException extends AppException {
  constructor() {
    // Distinct from ConsentRequiredException (a parent/self-verification
    // gate) — this is a *team-integrity* gate: the captain hasn't yet
    // confirmed this joiner is legitimately part of the team. Both gates
    // are independent and both must be clear before training-log/chat/
    // clips access — see assertTeamJoinApproved in each of those services.
    super(
      'team_join_approval_required',
      "The team captain hasn't approved this join yet.",
      HttpStatus.FORBIDDEN,
    );
  }
}

export class TeamJoinNotPendingException extends AppException {
  constructor() {
    // Mirrors ConsentNotPendingException's reasoning: approving/rejecting
    // a join that isn't actually pending (already approved, already
    // rejected, or the captain's own auto-approved join) is a stale-state
    // client error, not a 404 — the player row is real, just not
    // actionable this way anymore.
    super(
      'team_join_not_pending',
      'This player is not pending team-join approval.',
      HttpStatus.CONFLICT,
    );
  }
}

// Both session-reissue routes were disabled (SessionReissueDisabledException,
// 503 session_reissue_disabled) from 2026-07-05 to 2026-07-27, per a
// security-review finding: the reissue code was returned directly to
// whichever caller triggered it, so the same captain who triggered a
// teammate's reissue could redeem it themselves — full account takeover,
// no rate limit, no audit trail. Removed now that the redesign (docs/
// adr/0004-coach-auth-and-session-reissue.md's 2026-07-27 addendum) binds
// redemption to the target player's own parent_contact via email, never
// to whoever made the request — see SessionService.

export class SessionReissueRateLimitedException extends AppException {
  constructor() {
    // Same per-player cooldown-lock shape as ConsentReminderRateLimitedException
    // above — bounds inbox-spam harassment against a real family, not the
    // security boundary itself (that's parent_contact-bound delivery).
    // Thrown only on the captain-triggered path (the requester is already
    // authorized, so "try again later" leaks nothing); the self-service
    // path swallows this into its generic response instead, see
    // SessionService.requestReissueSelfService.
    super(
      'session_reissue_rate_limited',
      'A session-reissue code was already requested recently for this player; try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

// docs/adr/0012-profile-page-and-contact-email-change.md — the profile
// page's contact-email change flow.

export class ContactChangeRateLimitedException extends AppException {
  constructor() {
    // Same per-player cooldown-lock shape/reasoning as
    // SessionReissueRateLimitedException above. Always thrown directly
    // (unlike session reissue's self-service path) — this endpoint
    // requires the caller to already hold a valid session for the target
    // account, so there's no unauthenticated-enumeration concern to
    // swallow it for.
    super(
      'contact_change_rate_limited',
      'A contact-change code was already requested recently; try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export class InvalidOrExpiredContactChangeCodeException extends AppException {
  constructor() {
    // Deliberately generic, same posture as InvalidOrExpiredCodeException
    // — doesn't distinguish "no such code" from "expired" from
    // "already used". A distinct exception/code from that one (not
    // reused) since its message is specific to session reissue.
    super(
      'invalid_or_expired_contact_change_code',
      'This contact-change code is invalid, expired, or already used.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

// --- Fas 4 (self-service GDPR account erasure) -------------------------------
// docs/adr/0013-account-erasure.md.

export class ErasureBlockedPendingContactChangeException extends AppException {
  constructor() {
    // Decision 2's blocking security-reviewer finding — closes the chained
    // contact-change/erasure hijack path. The caller must let the pending
    // contact-change either apply or be cancelled first, then request
    // erasure again.
    super(
      'erasure_blocked_pending_contact_change',
      'An unresolved contact-change is still in flight for this account; let it apply or cancel it first, then request erasure again.',
      HttpStatus.CONFLICT,
    );
  }
}

export class ErasureRateLimitedException extends AppException {
  constructor() {
    // Same per-player cooldown-lock + daily-cap shape/reasoning as
    // ContactChangeRateLimitedException/SessionReissueRateLimitedException
    // — the realistic abuse surface is "a compromised session spamming a
    // family's inbox with a scary email," identical threat model.
    super(
      'erasure_rate_limited',
      'An account-erasure request was already made recently; try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export class ErasureSuccessorRequiredException extends AppException {
  constructor() {
    // ADR-0013 Decision 4 — "the current captain chooses," no optional
    // fallback field: a captain with at least one teammate must name a
    // successor up front.
    super(
      'erasure_successor_required',
      'successorPlayerId is required: the caller is the team captain and has at least one teammate.',
      HttpStatus.CONFLICT,
    );
  }
}

export class ErasureSuccessorNotAllowedException extends AppException {
  constructor() {
    super(
      'erasure_successor_not_allowed',
      'successorPlayerId must be omitted: the caller is not currently a captain with a teammate to hand off to.',
      HttpStatus.CONFLICT,
    );
  }
}

export class ErasureSuccessorInvalidException extends AppException {
  constructor() {
    // Deliberately generic, same posture as CaptainTransferTargetNotOnTeamException
    // — covers "not on this team," "is the requester themselves," and "is
    // themselves already mid-erasure" without distinguishing which.
    super(
      'erasure_successor_invalid',
      'successorPlayerId must name a different teammate on the same team who is not themselves mid-erasure.',
      HttpStatus.CONFLICT,
    );
  }
}

export class ErasureAlreadyActiveException extends AppException {
  constructor() {
    // Defensive backstop for idx_account_erasure_request_one_active_per_player
    // — should be unreachable in the normal single-request flow (the caller
    // would need to race two concurrent requests), kept for the same
    // reason CaptainTransferConflictException exists.
    super(
      'erasure_already_active',
      'An account-erasure request is already in progress for this account.',
      HttpStatus.CONFLICT,
    );
  }
}

export class ErasureRequestNotActiveException extends AppException {
  constructor() {
    // Thrown only by the authenticated cancel path (POST /me/erasure/cancel)
    // — unlike the mailed-link cancel routes (which use the friendly no-op
    // idiom, since an already-consumed link is an expected case there), an
    // authenticated caller with no active request is a genuine stale-state
    // client error, mirrors ConsentNotPendingException/TeamJoinNotPendingException.
    super(
      'erasure_request_not_active',
      'There is no requested/grace_period account-erasure request to cancel for this account.',
      HttpStatus.CONFLICT,
    );
  }
}

// --- Fas 8 (staff SSO/RBAC — docs/adr/0023-pt-role-and-staff-sso-rbac.md
// Part B) ------------------------------------------------------------------

export class StaffUnauthorizedException extends AppException {
  constructor(message = 'Missing or invalid staff session.') {
    // Distinct code from the player-facing UnauthorizedTokenException — a
    // completely separate cookie/secret universe (STAFF_JWT_SECRET, never
    // JWT_SECRET), per Decision B2.
    super('staff_unauthorized', message, HttpStatus.UNAUTHORIZED);
  }
}

export class StaffAccountRevokedException extends AppException {
  constructor() {
    // AdminAuthGuard's per-request revocation check (security-reviewer's
    // Part B pass, Finding 1) — this StaffAccount's revoked_at is set, so
    // no session for it (however fresh) ever grants admin authority again.
    super(
      'staff_account_revoked',
      'This staff account has been revoked.',
      HttpStatus.FORBIDDEN,
    );
  }
}

export class StaffAccountNotAdminException extends AppException {
  constructor() {
    // Thrown whether the account's current role column says 'pt' *or* its
    // current email simply isn't (or is no longer) on the live ADMIN_EMAILS
    // allow-list — AdminAuthGuard never distinguishes which, since neither
    // the role column nor the JWT's role claim is authoritative here (see
    // that guard's own comment).
    super(
      'not_admin',
      'This action requires admin authority.',
      HttpStatus.FORBIDDEN,
    );
  }
}

export class StaffAccountNotPtException extends AppException {
  constructor() {
    super(
      'not_pt',
      'This action requires a pt-role staff session.',
      HttpStatus.FORBIDDEN,
    );
  }
}

export class StaffOAuthPendingAuthInvalidException extends AppException {
  constructor() {
    // Covers a missing, expired, or signature-invalid staff_auth_pending
    // cookie — deliberately generic, same posture as
    // InvalidOrExpiredCodeException, doesn't distinguish which.
    super(
      'oauth_pending_auth_invalid',
      'No valid pending sign-in attempt found for this callback; start the sign-in flow again.',
      HttpStatus.UNAUTHORIZED,
    );
  }
}

export class StaffOAuthStateMismatchException extends AppException {
  constructor() {
    // ADR-0023 Decision B6 (security-reviewer's Part B pass, Finding 3) —
    // the callback's `state` query parameter didn't match the value minted
    // at login and held in the signed staff_auth_pending cookie. Also
    // covers a callback for the wrong provider (e.g. a google callback
    // presenting a pending-auth cookie minted for microsoft).
    super(
      'oauth_state_mismatch',
      'OAuth state parameter did not match — start the sign-in flow again.',
      HttpStatus.UNAUTHORIZED,
    );
  }
}

export class StaffOAuthCallbackRejectedException extends AppException {
  constructor() {
    // Wraps any rejection openid-client itself raises during the token
    // exchange/ID-token validation — including a nonce mismatch, an
    // expired/replayed authorization code, or a PKCE verifier mismatch
    // (ADR-0023 Decision B6). Deliberately generic in the response (never
    // echoes the library's own error text to the client), same posture as
    // every other auth-boundary exception in this file.
    super(
      'oauth_callback_rejected',
      'OAuth sign-in could not be completed — start the sign-in flow again.',
      HttpStatus.UNAUTHORIZED,
    );
  }
}

// ADR-0013 Decision 4 — PlayersService.transferCaptaincy's new rejection:
// a captain can no longer hand off onto a teammate who is themselves
// already mid-erasure (requested or grace_period), closing the gap where
// that handoff would need immediate unwinding a moment later.
export class CaptainTransferTargetMidErasureException extends AppException {
  constructor() {
    super(
      'captain_transfer_target_mid_erasure',
      'newCaptainPlayerId has an active account-erasure request and cannot be made captain.',
      HttpStatus.CONFLICT,
    );
  }
}

// --- Fas 8 (PT role — docs/adr/0023-pt-role-and-staff-sso-rbac.md Part A,
// Decisions A2-A5) --------------------------------------------------------

export class PtInviteCodeInvalidException extends AppException {
  constructor() {
    // Deliberately generic, same posture as InviteCodeNotFoundException —
    // covers "no such code", "expired", and "already redeemed" without
    // distinguishing which.
    super(
      'pt_invite_code_invalid',
      'This PT team-invite code is invalid, expired, or already used.',
      HttpStatus.NOT_FOUND,
    );
  }
}

export class PtTeamLinkAlreadyActiveException extends AppException {
  constructor() {
    // Defensive backstop for idx_pt_team_link_one_active_per_team_pt —
    // should be unreachable in the normal single-request flow, kept for
    // the same reason ErasureAlreadyActiveException exists.
    super(
      'pt_team_link_already_active',
      'This PT already has an active link to this team.',
      HttpStatus.CONFLICT,
    );
  }
}

export class PtTeamLinkNotFoundException extends AppException {
  constructor() {
    super(
      'pt_team_link_not_found',
      'No active PT team-link with this id was found for this team.',
      HttpStatus.NOT_FOUND,
    );
  }
}

// docs/adr/0023 Decision A2/A3, Finding 6 (see the ADR's Status section) —
// thrown by every PT-authenticated endpoint that requires an active
// PtTeamLink to the target player's team: the consent-request write
// endpoint AND (per the security-reviewer fix) the consent-status read
// endpoint, identically. Without this on the read endpoint too, a `pt`-
// role account with zero active team links could enumerate consent-status
// for arbitrary player IDs app-wide.
export class PtNoActiveTeamLinkException extends AppException {
  constructor() {
    super(
      'no_active_team_link',
      'This PT has no active team-link to the requested player’s team.',
      HttpStatus.FORBIDDEN,
    );
  }
}

export class PtConsentAlreadyActiveException extends AppException {
  constructor() {
    // Defensive backstop for idx_pt_player_consent_one_active_per_pt_player
    // + the explicit dedupe check PtConsentService performs first.
    super(
      'pt_consent_already_active',
      'A pending or approved consent request already exists for this PT/player pair.',
      HttpStatus.CONFLICT,
    );
  }
}

export class PtConsentBlockedPendingContactChangeException extends AppException {
  constructor() {
    // The exact contact-change-hijack-race fix from ADR-0013 Decision 2 /
    // ADR-0019, reused verbatim for this new mailed-consent flow.
    super(
      'pt_consent_blocked_pending_contact_change',
      'A contact-email change is pending for this player — try again once it resolves.',
      HttpStatus.CONFLICT,
    );
  }
}

export class PtConsentRateLimitedException extends AppException {
  constructor() {
    super(
      'pt_consent_rate_limited',
      'Too many consent requests from this PT account recently — try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

// docs/adr/0023 Decision A3's recommended additional guardrail: a global
// cap on how many *pending* (not yet decided) consent requests one PT
// account may have open at once — a compromised/bad-faith PT's
// cross-team reach makes this a higher-leverage abuse surface than an
// ordinary player's.
export class PtConsentPendingCapExceededException extends AppException {
  constructor() {
    super(
      'pt_consent_pending_cap_exceeded',
      'This PT account already has the maximum number of pending consent requests open.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export class PtConsentNotApprovedException extends AppException {
  constructor() {
    // Thrown by the per-player training-data allow-list read whenever no
    // currently-`approved` PtPlayerConsent exists for this (pt, player)
    // pair — re-checked live on every request (Decision A4), never a
    // cached grant.
    super(
      'pt_consent_not_approved',
      'No approved consent exists for this PT to view this player’s training data.',
      HttpStatus.FORBIDDEN,
    );
  }
}

export class PtPlayerConsentNotFoundException extends AppException {
  constructor() {
    // Deliberately generic — covers "no such id", "not owned by this
    // player", and "already in a terminal state" without distinguishing
    // which, same posture as InviteCodeNotFoundException.
    super(
      'pt_player_consent_not_found',
      'No active PT consent with this id was found for this player.',
      HttpStatus.NOT_FOUND,
    );
  }
}

// --- Fas 4.6 (video-clip challenge notifications —
// docs/adr/0021-clip-challenge-notifications.md) -----------------------------

export class NotYourChallengeException extends AppException {
  constructor() {
    // Mirrors NotYourClipException's shape/naming for uploader-only
    // actions, extended to the tagged-player-only ack (ADR-0021 Decision
    // 1's "GET/POST .../clips/challenges/..." endpoints).
    super(
      'not_your_challenge',
      'Only the tagged player can acknowledge this challenge.',
      HttpStatus.FORBIDDEN,
    );
  }
}

export class SystemMessageNotReportableException extends AppException {
  constructor() {
    // ADR-0021's 2026-08-06 security-reviewer addendum, finding 1 (binding,
    // not optional): a system-authored chat message has no real sender to
    // report — block is inert against it for free (blocked_player_id is
    // NOT NULL), but report has no equivalent structural safety, so this
    // guard exists to close that gap explicitly.
    super(
      'cannot_report_system_message',
      'System-authored chat messages cannot be reported — there is no real sender to report.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

// --- Fas 7 (admin control center / in-app bug reports —
// docs/adr/0022-admin-control-center.md Decision 7) -------------------------

export class BugReportRateLimitedException extends AppException {
  constructor() {
    // Same per-player burst-cooldown + daily-cap shape as
    // ErasureRateLimitedException, which docs/design/phase7-admin-console-
    // flows.md §13 explicitly names as the precedent this code should
    // mirror. Different threat model, though (named here rather than
    // inherited by analogy): submitting a bug report emails nobody and
    // touches no other account, so what's being bounded is queue spam
    // against the single operator, not a family's inbox.
    super(
      'bug_report_rate_limited',
      'A few bug reports were already sent from this account recently; try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export class BugReportNotFoundException extends AppException {
  constructor() {
    // A real, expected case rather than a defensive backstop: `player_id`
    // is ON DELETE CASCADE, so an account erasure removes a report while
    // the operator may still have it open — docs/design/phase7-admin-
    // console-flows.md §6.4's `gone` state exists precisely for this, and
    // renders "the reporter's account was probably erased" instead of a
    // generic failure.
    super(
      'bug_report_not_found',
      'No bug report with this id exists.',
      HttpStatus.NOT_FOUND,
    );
  }
}
