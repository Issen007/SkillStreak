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
