import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { UnauthorizedTokenException } from '../common/errors/exceptions';
import { Player } from '../players/entities/player.entity';
import { JwtPayload } from './jwt-payload.interface';
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

// Injects the Player *entity* directly (via a scoped TypeOrmModule.
// forFeature registration on AuthModule itself — see that module), not
// PlayersService/PlayersModule: PlayersModule already depends on
// AuthModule (for the JWT machinery used elsewhere), so importing
// PlayersModule back into AuthModule would be circular. The entity has no
// such dependency, so this is the boring way to add ADR-0004 Part 3's
// token_version check without restructuring the module graph.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly playerTokenService: PlayerTokenService,
    @InjectRepository(Player)
    private readonly playerRepository: Repository<Player>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedTokenException();
    }

    let payload: JwtPayload;
    try {
      payload = await this.playerTokenService.verify(token);
    } catch {
      throw new UnauthorizedTokenException(
        'Session token is invalid or expired.',
      );
    }

    // ADR-0004 Part 3: one extra indexed lookup per guarded request, a
    // deliberate/accepted cost at this project's scale (see the ADR's
    // Consequences). A missing player (e.g. a hard-deleted row) is treated
    // the same as an invalid token, not surfaced as a 404/500 further down
    // the stack — from the client's perspective both mean "your session is
    // gone."
    const player = await this.playerRepository.findOne({
      where: { id: payload.sub },
      select: ['id', 'tokenVersion'],
    });
    const tokenVersion = payload.tokenVersion ?? 0;
    if (!player || player.tokenVersion !== tokenVersion) {
      throw new UnauthorizedTokenException(
        'Session token is invalid or expired.',
      );
    }

    request.playerId = payload.sub;
    return true;
  }
}
