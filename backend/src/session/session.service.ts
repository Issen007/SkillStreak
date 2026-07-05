import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InvalidOrExpiredCodeException } from '../common/errors/exceptions';
import { PlayerTokenService } from '../auth/player-token.service';
import { PlayersService } from '../players/players.service';
import { generateSessionReissueCode } from './session-reissue-code.util';

export interface SessionReissueResponse {
  reissueCode: string;
  expiresAt: string;
}

export interface SessionRedeemResponse {
  playerId: string;
  sessionToken: string;
}

// ADR-0004 Part 3 (player session reissue), triggered by a team's captain
// via their ordinary player JWT (ADR-0005's authorization change — the
// mechanism itself is unchanged from the ADR). Deliberately its own module
// rather than folded into PlayersModule/PlayersController: this is a
// distinct auth-lifecycle concern (mirrors why ConsentModule is its own
// module rather than living in PlayersModule), even though it reuses
// Player's columns.
@Injectable()
export class SessionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly playersService: PlayersService,
    private readonly playerTokenService: PlayerTokenService,
  ) {}

  /**
   * POST /players/:playerId/session-reissue — captain-only (checked
   * against the *target* player's team, not the path; there is no
   * `:teamId` in this route). One transaction: bump token_version
   * (invalidating every existing token for the target immediately) +
   * generate a fresh 15-minute code, per ADR-0004 Part 3.
   */
  async triggerReissue(
    requesterId: string,
    targetPlayerId: string,
  ): Promise<SessionReissueResponse> {
    const targetPlayer =
      await this.playersService.findByIdOrThrow(targetPlayerId);
    await this.playersService.assertIsCaptainOfTeam(
      requesterId,
      targetPlayer.teamId,
    );

    return this.dataSource.transaction(async (manager) => {
      const locked = await this.playersService.findByIdForUpdate(
        manager,
        targetPlayerId,
      );
      const { code, expiresAt } = generateSessionReissueCode();
      await this.playersService.setSessionReissueCode(manager, targetPlayerId, {
        newTokenVersion: locked.tokenVersion + 1,
        code,
        expiresAt,
      });
      return { reissueCode: code, expiresAt: expiresAt.toISOString() };
    });
  }

  /**
   * POST /players/session/redeem — no auth (the whole point: the caller
   * has no valid session). Validates the code (exists, unexpired, unused),
   * nulls it (single-use), and issues a fresh JWT carrying the player's
   * *current* tokenVersion.
   */
  async redeem(code: string): Promise<SessionRedeemResponse> {
    return this.dataSource.transaction(async (manager) => {
      const player = await this.playersService.findValidBySessionReissueCode(
        manager,
        code,
      );
      if (!player) {
        throw new InvalidOrExpiredCodeException();
      }
      await this.playersService.clearSessionReissueCode(manager, player.id);
      const sessionToken = this.playerTokenService.issueFor(
        player.id,
        player.tokenVersion,
      );
      return { playerId: player.id, sessionToken };
    });
  }
}
