import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { UnauthorizedTokenException } from '../common/errors/exceptions';
import { PlayerTokenService } from './player-token.service';

// Request augmentation so downstream handlers/decorators can read the
// authenticated playerId without re-parsing the token.
declare module 'express' {
  interface Request {
    playerId?: string;
  }
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly playerTokenService: PlayerTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedTokenException();
    }

    try {
      const payload = await this.playerTokenService.verify(token);
      request.playerId = payload.sub;
      return true;
    } catch {
      throw new UnauthorizedTokenException(
        'Session token is invalid or expired.',
      );
    }
  }
}
