import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlayerId } from '../auth/current-player-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PtConsentService } from './pt-consent.service';

// docs/adr/0023-pt-role-and-staff-sso-rbac.md Decision A4 point 1 — the
// player's own in-app, self-service revocation lever, no parent needed.
// Ownership-checked inside PtConsentService.playerSelfRevoke itself.
@Controller('api/v1/players/me/pt-consents')
@UseGuards(JwtAuthGuard)
export class PtPlayerConsentsController {
  constructor(private readonly ptConsentService: PtConsentService) {}

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(
    @CurrentPlayerId() playerId: string,
    @Param('id') consentId: string,
  ): Promise<{ revoked: true }> {
    return this.ptConsentService.playerSelfRevoke(playerId, consentId);
  }
}
