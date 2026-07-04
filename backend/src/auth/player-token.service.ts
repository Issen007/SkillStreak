import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from './jwt-payload.interface';

@Injectable()
export class PlayerTokenService {
  constructor(private readonly jwtService: JwtService) {}

  issueFor(playerId: string): string {
    const payload: JwtPayload = { sub: playerId };
    return this.jwtService.sign(payload);
  }

  async verify(token: string): Promise<JwtPayload> {
    return this.jwtService.verifyAsync<JwtPayload>(token);
  }
}
