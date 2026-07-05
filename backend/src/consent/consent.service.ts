import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConsentMethod } from '../player-private-info/entities/parental-consent-record.entity';
import { PlayerPrivateInfoService } from '../player-private-info/player-private-info.service';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { PlayersService } from '../players/players.service';

export interface ConsentPreview {
  screenName: string;
}

export interface ConsentApprovalResult {
  screenName: string;
}

// Orchestrates the parent-facing consent-approval flow across both
// PlayersModule (the token + gameplay-gating status live on Player) and
// PlayerPrivateInfoModule (the append-only ParentalConsentRecord audit
// trail) — this is the one other module (besides OnboardingService)
// allowed to depend on both, per docs/adr/0002-data-model.md's addendum §1.
@Injectable()
export class ConsentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly playersService: PlayersService,
    private readonly playerPrivateInfoService: PlayerPrivateInfoService,
  ) {}

  /**
   * Read-only preview for GET /api/v1/consent/:token — no side effects, see
   * ConsentController's comment on why (email client/security-scanner
   * prefetching). Returns null for both "no such token" and "expired",
   * deliberately not distinguished.
   */
  async previewByToken(token: string): Promise<ConsentPreview | null> {
    const player = await this.playersService.findValidByConsentToken(token);
    return player ? { screenName: player.screenName } : null;
  }

  /**
   * The actual approval, for POST /api/v1/consent/:token: flips
   * Player.parental_consent_status to approved and clears the token
   * (PlayersService.approveByConsentToken), then appends the audit-trail
   * ParentalConsentRecord (PlayerPrivateInfoService) — both in one
   * transaction, matching OnboardingService's cross-module write pattern.
   * Returns null if the token was already consumed/invalid/expired, which
   * the controller renders as a friendly "already confirmed" page.
   */
  async approve(token: string): Promise<ConsentApprovalResult | null> {
    return this.dataSource.transaction(async (manager) => {
      const player = await this.playersService.approveByConsentToken(
        manager,
        token,
      );
      if (!player) {
        return null;
      }

      await this.playerPrivateInfoService.recordConsentEvent(
        manager,
        player.id,
        ParentalConsentStatus.APPROVED,
        ConsentMethod.EMAIL_LINK,
      );

      return { screenName: player.screenName };
    });
  }
}
