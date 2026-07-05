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
