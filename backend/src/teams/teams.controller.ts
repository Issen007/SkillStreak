import { Controller, Get, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InviteCodeNotFoundException } from '../common/errors/exceptions';
import { TeamsService } from './teams.service';

interface TeamInvitePreviewResponse {
  teamId: string;
  teamName: string;
}

@Controller('api/v1/teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  // No auth — a device doesn't have a token yet at this point, per
  // docs/api/phase1-contract.md. The invite code is deliberately
  // low-entropy (spoken at practice), so this route is brute-forceable
  // without a tight per-IP rate limit — 10/min is enough for a coach's
  // whole practice session of kids previewing their team once each, but
  // not enough to enumerate invite codes at any useful rate.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('invite/:inviteCode')
  async previewByInviteCode(
    @Param('inviteCode') inviteCode: string,
  ): Promise<TeamInvitePreviewResponse> {
    const team = await this.teamsService.findByInviteCode(inviteCode);
    if (!team) {
      throw new InviteCodeNotFoundException();
    }
    return { teamId: team.id, teamName: team.name };
  }
}
