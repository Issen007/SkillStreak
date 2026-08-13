import { Throttle } from '@nestjs/throttler';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PtAuthGuard } from '../staff-auth/guards/pt-auth.guard';
import { CurrentStaffAccountId } from './current-staff-account-id.decorator';
import { RedeemPtTeamLinkInviteDto } from './dto/redeem-pt-team-link-invite.dto';
import {
  PtConsentRequestResult,
  PtConsentService,
  PtConsentStatusResponse,
} from './pt-consent.service';
import {
  PtPlayerTrainingDataView,
  PtTeamAggregateView,
  PtDataService,
} from './pt-data.service';
import { PtTeamLinkRow, PtTeamLinksService } from './pt-team-links.service';

// docs/adr/0023-pt-role-and-staff-sso-rbac.md Part A's PT-authenticated
// surface (`PtAuthGuard`, cheap JWT-hint-only — see that guard's own
// comment). Every method here is scoped to the CALLING PT's own
// `staffAccountId` only (from the guard, never a body/query param a
// caller could substitute another PT's id into) — per Decision B4, only
// `AdminAuthGuard`-gated oversight routes (a follow-up, not built by this
// task — see docs/ACTION_PLAN.md's Phase 8 write-up) are ever allowed to
// pass a different PT's id to the same underlying PtDataService methods.
@Controller('api/v1/pt')
@UseGuards(PtAuthGuard)
export class PtController {
  constructor(
    private readonly ptTeamLinksService: PtTeamLinksService,
    private readonly ptConsentService: PtConsentService,
    private readonly ptDataService: PtDataService,
  ) {}

  @Post('team-links/redeem')
  @HttpCode(HttpStatus.CREATED)
  redeemTeamLinkInvite(
    @CurrentStaffAccountId() ptStaffAccountId: string,
    @Body() dto: RedeemPtTeamLinkInviteDto,
  ): Promise<PtTeamLinkRow> {
    return this.ptTeamLinksService.redeemInvite(ptStaffAccountId, dto.code);
  }

  // Decision A5's team-aggregate tier — one entry per currently-active
  // PtTeamLink this PT holds (team name/pot/active goal + roster screen
  // names/consent status). Zero per-player training-data visibility.
  @Get('team-links')
  getTeamAggregateViews(
    @CurrentStaffAccountId() ptStaffAccountId: string,
  ): Promise<PtTeamAggregateView[]> {
    return this.ptDataService.getTeamAggregateViewsForPt(ptStaffAccountId);
  }

  @Post('players/:playerId/consent-requests')
  @HttpCode(HttpStatus.CREATED)
  requestConsent(
    @CurrentStaffAccountId() ptStaffAccountId: string,
    @Param('playerId') playerId: string,
  ): Promise<PtConsentRequestResult> {
    return this.ptConsentService.requestConsent(ptStaffAccountId, playerId);
  }

  /**
   * Re-send a pending request's email — for the coach whose message was
   * missed, filtered as spam, or left too long. Rotates the review code,
   * so the previous link stops working.
   *
   * **Rate-limited far harder than the surrounding routes, and that is
   * the point**: this endpoint causes email to arrive at a child's
   * parent. Three per hour is generous for a coach chasing one family and
   * useless for anyone trying to use this app to pester them. The rest of
   * the guard is on the service — own request only, pending only, active
   * team link only.
   */
  @Post('players/:playerId/consent-requests/resend')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  resendConsentRequest(
    @CurrentStaffAccountId() ptStaffAccountId: string,
    @Param('playerId') playerId: string,
  ): Promise<{ resent: true; expiresAt: string }> {
    return this.ptConsentService.resendConsentRequest(
      ptStaffAccountId,
      playerId,
    );
  }

  // security-reviewer's Part A pass, Finding 6 (see the ADR's Status
  // section) — requires the IDENTICAL active-PtTeamLink check as the
  // write endpoint above (enforced inside PtConsentService.
  // getConsentStatus itself), closing the enumeration gap a PT with zero
  // active team links would otherwise have here.
  @Get('players/:playerId/consent-status')
  getConsentStatus(
    @CurrentStaffAccountId() ptStaffAccountId: string,
    @Param('playerId') playerId: string,
  ): Promise<{ status: PtConsentStatusResponse }> {
    return this.ptConsentService.getConsentStatus(ptStaffAccountId, playerId);
  }

  // Decision A5's per-player training-data allow-list — 403
  // pt_consent_not_approved unless a currently-`approved` PtPlayerConsent
  // exists for this exact (pt, player) pair, re-checked live on every call.
  @Get('players/:playerId')
  getPlayerTrainingData(
    @CurrentStaffAccountId() ptStaffAccountId: string,
    @Param('playerId') playerId: string,
  ): Promise<PtPlayerTrainingDataView> {
    return this.ptDataService.getPlayerTrainingData(ptStaffAccountId, playerId);
  }
}
