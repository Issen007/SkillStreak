import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlayerId } from '../auth/current-player-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  PtTeamLinkInviteResult,
  PtTeamLinkRow,
  PtTeamLinksService,
} from './pt-team-links.service';

// docs/adr/0023-pt-role-and-staff-sso-rbac.md Decision A2 (invite
// generation) / Decision A4 point 3 (team-level revoke). Captain-only —
// reuses PlayersService.assertIsCaptainOfTeam (called inside
// PtTeamLinksService, not a new guard class), the same "no new CaptainGuard
// class, a service-layer check is enough" precedent ADR-0005 already set.
@Controller('api/v1/teams/:teamId/pt-links')
@UseGuards(JwtAuthGuard)
export class PtTeamLinksController {
  constructor(private readonly ptTeamLinksService: PtTeamLinksService) {}

  @Post('invite')
  @HttpCode(HttpStatus.CREATED)
  generateInvite(
    @CurrentPlayerId() requesterId: string,
    @Param('teamId') teamId: string,
  ): Promise<PtTeamLinkInviteResult> {
    return this.ptTeamLinksService.generateInvite(requesterId, teamId);
  }

  @Get()
  listForTeam(
    @CurrentPlayerId() requesterId: string,
    @Param('teamId') teamId: string,
  ): Promise<PtTeamLinkRow[]> {
    return this.ptTeamLinksService.listForTeam(requesterId, teamId);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(
    @CurrentPlayerId() requesterId: string,
    @Param('teamId') teamId: string,
    @Param('id') id: string,
  ): Promise<{ revoked: true; cascadedConsentCount: number }> {
    return this.ptTeamLinksService.revoke(requesterId, teamId, id);
  }
}
