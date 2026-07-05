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

export class SessionReissueDisabledException extends AppException {
  constructor() {
    // Disabled 2026-07-05 per a security review finding: the reissue code
    // is returned directly to whichever caller triggers it (intended to be
    // relayed in person to the target player), but nothing technically
    // stops that same caller from redeeming it themselves — a captain can
    // fully impersonate any teammate, with no rate limit or audit trail.
    // The underlying service/logic (SessionService, token_version,
    // single-use code redemption) is otherwise sound and stays in place;
    // only these two routes are gated off pending a redesign that binds
    // redemption to the target player rather than to bearer possession of
    // the code. See docs/adr/0004-coach-auth-and-session-reissue.md Part 3
    // and docs/ACTION_PLAN.md's Phase 2 security-review follow-ups.
    super(
      'session_reissue_disabled',
      'Session reissue is temporarily disabled pending a security fix.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
