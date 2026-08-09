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
import { PtConsentService, PtConsentSummary } from './pt-consent.service';

// docs/adr/0023-pt-role-and-staff-sso-rbac.md Decision A4 point 1 — the
// player's own in-app, self-service revocation lever, no parent needed.
// Ownership-checked inside PtConsentService.playerSelfRevoke itself.
@Controller('api/v1/players/me/pt-consents')
@UseGuards(JwtAuthGuard)
export class PtPlayerConsentsController {
  constructor(private readonly ptConsentService: PtConsentService) {}

  /**
   * Screen PL1's list (docs/design/phase8-pt-flows.md §7). Added
   * 2026-08-09 alongside the design pass, which found that A4's
   * self-service revoke lever shipped with no way for the child to see
   * what they were revoking. Own relationships only — the guard plus the
   * service's `playerId` filter mean there is no id to tamper with.
   */
  @Get()
  list(@CurrentPlayerId() playerId: string): Promise<PtConsentSummary[]> {
    return this.ptConsentService.listOwnConsents(playerId);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(
    @CurrentPlayerId() playerId: string,
    @Param('id') consentId: string,
  ): Promise<{ revoked: true }> {
    return this.ptConsentService.playerSelfRevoke(playerId, consentId);
  }
}
