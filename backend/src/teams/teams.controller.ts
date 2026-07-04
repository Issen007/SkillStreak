import { Controller, Get, Param } from '@nestjs/common';
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
  // docs/api/phase1-contract.md.
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
