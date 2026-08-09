import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  PtConsentAlreadyActiveException,
  PtConsentBlockedPendingContactChangeException,
  PtConsentPendingCapExceededException,
  PtConsentRateLimitedException,
  PtNoActiveTeamLinkException,
  PtPlayerConsentNotFoundException,
} from '../common/errors/exceptions';
import { decryptPii, encryptPii } from '../common/crypto/pii-encryption.util';
import { generateHumanCode } from '../common/crypto/human-code.util';
import { isSelfVerificationAge } from '../common/age/self-verification-age.util';
import { isPostgresUniqueViolation } from '../common/errors/postgres-error.util';
import { PlayerLocale } from '../common/locale/player-locale.enum';
import { MailService } from '../mail/mail.service';
import { buildPtConsentApprovedEmail } from '../mail/templates/pt-consent-approved-email.template';
import { buildPtConsentRequestEmail } from '../mail/templates/pt-consent-request-email.template';
import { PlayerPrivateInfoService } from '../player-private-info/player-private-info.service';
import { PlayersService } from '../players/players.service';
import { RedisService } from '../redis/redis.service';
import { StaffAccount } from '../staff-auth/entities/staff-account.entity';
import {
  PtPlayerConsent,
  PtPlayerConsentRevokedReason,
  PtPlayerConsentStatus,
} from './entities/pt-player-consent.entity';
import { PtTeamLink, PtTeamLinkStatus } from './entities/pt-team-link.entity';
import {
  DEFAULT_PT_MAX_PENDING_CONSENT_REQUESTS,
  PT_CONSENT_REVIEW_CODE_TTL_MS,
} from './pt.constants';

const ONE_ACTIVE_CONSENT_PER_PT_PLAYER_CONSTRAINT =
  'idx_pt_player_consent_one_active_per_pt_player';

const DEFAULT_APP_PUBLIC_URL = 'http://localhost:3000';

export type PtConsentStatusResponse = 'none' | 'pending_review' | 'approved';

/** Screen PL1's row shape — see listOwnConsents. */
export interface PtConsentSummary {
  id: string;
  ptDisplayName: string;
  status: PtPlayerConsentStatus;
  decidedAt: string | null;
  revokedAt: string | null;
}

export interface PtConsentRequestResult {
  requested: true;
  expiresAt: string;
}

// docs/adr/0023-pt-role-and-staff-sso-rbac.md Decision A3 (the per-
// relationship consent gate) and Decision A4 (its three-lever
// revocation). Reuses ADR-0013 Decision 2's contact-change-hijack-race fix
// verbatim (checked first, before the rate-limit budget is burned; a
// single getParentContact() call, snapshotted once) and the same
// GET-preview/POST-action mailed-link idiom as AccountErasureService.
@Injectable()
export class PtConsentService {
  private readonly logger = new Logger(PtConsentService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly playersService: PlayersService,
    private readonly playerPrivateInfoService: PlayerPrivateInfoService,
    private readonly redisService: RedisService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    @InjectRepository(PtPlayerConsent)
    private readonly ptPlayerConsentRepository: Repository<PtPlayerConsent>,
    @InjectRepository(PtTeamLink)
    private readonly ptTeamLinkRepository: Repository<PtTeamLink>,
    @InjectRepository(StaffAccount)
    private readonly staffAccountRepository: Repository<StaffAccount>,
  ) {}

  private get encryptionKey(): string {
    return this.configService.getOrThrow<string>('PII_ENCRYPTION_KEY');
  }

  private appPublicUrl(): string {
    return (
      this.configService.get<string>('APP_PUBLIC_URL') ?? DEFAULT_APP_PUBLIC_URL
    );
  }

  private maxPendingConsentRequests(): number {
    const configured = this.configService.get<string>(
      'PT_MAX_PENDING_CONSENT_REQUESTS',
    );
    const parsed = configured ? Number(configured) : NaN;
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_PT_MAX_PENDING_CONSENT_REQUESTS;
  }

  /**
   * Shared by requestConsent AND getConsentStatus (Decision A2/A3,
   * security-reviewer's Part A pass Finding 6) — the exact same
   * active-PtTeamLink-to-the-player's-team check on BOTH the write and the
   * read endpoint, closing the enumeration gap a PT with zero active team
   * links would otherwise have on the read endpoint alone.
   */
  private async assertActiveTeamLink(
    ptStaffAccountId: string,
    teamId: string,
  ): Promise<PtTeamLink> {
    const link = await this.ptTeamLinkRepository.findOne({
      where: {
        ptStaffAccountId,
        teamId,
        status: PtTeamLinkStatus.ACTIVE,
      },
    });
    if (!link) {
      throw new PtNoActiveTeamLinkException();
    }
    return link;
  }

  /**
   * docs/adr/0023 Decision A3's endpoint — PT-initiated. Order: fetch the
   * target player -> the active-team-link check (403 no_active_team_link,
   * closes "PT scans for random players across the whole app" outright) ->
   * the contact-change-race gate (Decision 2, checked before burning rate-
   * limit budget) -> the dedupe check (an already-active consent for this
   * exact (pt, player) pair) -> rate limiting (burst, then daily cap) ->
   * the global pending-request cap (Decision A3's recommended additional
   * guardrail) -> the one-time parentContact resolution -> persist ->
   * best-effort email.
   */
  async requestConsent(
    ptStaffAccountId: string,
    playerId: string,
  ): Promise<PtConsentRequestResult> {
    const player = await this.playersService.findByIdOrThrow(playerId);
    const link = await this.assertActiveTeamLink(
      ptStaffAccountId,
      player.teamId,
    );

    if (await this.playerPrivateInfoService.hasPendingContactChange(playerId)) {
      throw new PtConsentBlockedPendingContactChangeException();
    }

    const existingActive = await this.ptPlayerConsentRepository.findOne({
      where: [
        {
          ptStaffAccountId,
          playerId,
          status: PtPlayerConsentStatus.PENDING_REVIEW,
        },
        {
          ptStaffAccountId,
          playerId,
          status: PtPlayerConsentStatus.APPROVED,
        },
      ],
    });
    if (existingActive) {
      if (
        existingActive.status === PtPlayerConsentStatus.PENDING_REVIEW &&
        !isReviewCodeLive(existingActive)
      ) {
        // The parent/player never acted before the review link expired.
        // Expire the stale row explicitly (moving it out of
        // ONE_ACTIVE_CONSENT_PER_PT_PLAYER_CONSTRAINT's partial-index scope,
        // which only covers pending_review/approved) rather than leaving it
        // pending_review forever — otherwise this exact (PT, player) pair
        // could never be re-requested short of the captain revoking the
        // entire team link (code-critic finding, this ADR's own review
        // pass having defined an `expired` status that nothing ever set).
        existingActive.status = PtPlayerConsentStatus.EXPIRED;
        existingActive.decidedAt = new Date();
        await this.ptPlayerConsentRepository.save(existingActive);
      } else {
        throw new PtConsentAlreadyActiveException();
      }
    }

    const burstClaimed =
      await this.redisService.tryClaimPtConsentRequestCooldown(
        ptStaffAccountId,
      );
    if (!burstClaimed) {
      throw new PtConsentRateLimitedException();
    }
    const dailyClaimed =
      await this.redisService.tryClaimPtConsentRequestDailyCap(
        ptStaffAccountId,
      );
    if (!dailyClaimed) {
      throw new PtConsentRateLimitedException();
    }

    const pendingCount = await this.ptPlayerConsentRepository.count({
      where: {
        ptStaffAccountId,
        status: PtPlayerConsentStatus.PENDING_REVIEW,
      },
    });
    if (pendingCount >= this.maxPendingConsentRequests()) {
      throw new PtConsentPendingCapExceededException();
    }

    // Decision 2 step 2 — resolved exactly once, for the rest of this
    // row's lifecycle.
    const parentContact =
      await this.playerPrivateInfoService.getParentContact(playerId);
    const { code, expiresAt } = generateHumanCode(
      PT_CONSENT_REVIEW_CODE_TTL_MS,
    );

    let saved: PtPlayerConsent;
    try {
      saved = await this.ptPlayerConsentRepository.save(
        this.ptPlayerConsentRepository.create({
          ptTeamLinkId: link.id,
          ptStaffAccountId,
          playerId,
          status: PtPlayerConsentStatus.PENDING_REVIEW,
          reviewCode: code,
          reviewCodeExpiresAt: expiresAt,
          recipientContactSnapshot: parentContact
            ? encryptPii(parentContact, this.encryptionKey)
            : null,
        }),
      );
    } catch (error) {
      if (
        isPostgresUniqueViolation(
          error,
          ONE_ACTIVE_CONSENT_PER_PT_PLAYER_CONSTRAINT,
        )
      ) {
        throw new PtConsentAlreadyActiveException();
      }
      throw error;
    }
    void saved;

    const ptStaffAccount = await this.staffAccountRepository.findOne({
      where: { id: ptStaffAccountId },
    });

    await this.sendRequestEmailBestEffort(
      player.screenName,
      player.locale,
      isSelfVerificationAge(player.birthYear),
      parentContact,
      ptStaffAccount?.displayName ?? ptStaffAccount?.email ?? 'okänd tränare',
      ptStaffAccount?.email ?? '',
      code,
    );

    return { requested: true, expiresAt: expiresAt.toISOString() };
  }

  /**
   * docs/adr/0023 Decision A3, security-reviewer Finding 6 — requires the
   * IDENTICAL active-PtTeamLink check as requestConsent above. Returns the
   * currently-active status (at most one of pending_review/approved can
   * exist at once, per the partial unique index) or 'none'.
   */
  async getConsentStatus(
    ptStaffAccountId: string,
    playerId: string,
  ): Promise<{ status: PtConsentStatusResponse }> {
    const player = await this.playersService.findByIdOrThrow(playerId);
    await this.assertActiveTeamLink(ptStaffAccountId, player.teamId);

    const active = await this.ptPlayerConsentRepository.findOne({
      where: [
        {
          ptStaffAccountId,
          playerId,
          status: PtPlayerConsentStatus.PENDING_REVIEW,
        },
        {
          ptStaffAccountId,
          playerId,
          status: PtPlayerConsentStatus.APPROVED,
        },
      ],
    });
    if (!active) return { status: 'none' };
    return {
      status:
        active.status === PtPlayerConsentStatus.APPROVED
          ? 'approved'
          : 'pending_review',
    };
  }

  // --- Mailed review-and-approve (unauthenticated) --------------------------

  /** GET-side preview — no side effects, same reasoning as
   * AccountErasureService.previewConfirm (email clients/security scanners
   * prefetch links). */
  async previewByReviewCode(code: string): Promise<{
    screenName: string;
    ptDisplayName: string;
    ptEmail: string;
  } | null> {
    const row = await this.ptPlayerConsentRepository.findOne({
      where: { reviewCode: code },
    });
    if (
      !row ||
      row.status !== PtPlayerConsentStatus.PENDING_REVIEW ||
      !isReviewCodeLive(row)
    ) {
      return null;
    }
    const player = await this.playersService.findById(row.playerId);
    if (!player) return null;
    const ptStaffAccount = await this.staffAccountRepository.findOne({
      where: { id: row.ptStaffAccountId },
    });
    return {
      screenName: player.screenName,
      ptDisplayName: ptStaffAccount?.displayName ?? ptStaffAccount?.email ?? '',
      ptEmail: ptStaffAccount?.email ?? '',
    };
  }

  /**
   * The POST side — approval. Mints the non-expiring revoke_code (Decision
   * A4 point 2) in the same transaction. Returns `null` for "no such code /
   * expired / already decided" (friendly no-op idiom, same as
   * AccountErasureService.confirmErasure).
   */
  async approveByReviewCode(
    code: string,
  ): Promise<{ ptDisplayName: string } | null> {
    const result = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(PtPlayerConsent);
      const row = await repository
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.review_code = :code', { code })
        .getOne();
      if (
        !row ||
        row.status !== PtPlayerConsentStatus.PENDING_REVIEW ||
        !isReviewCodeLive(row)
      ) {
        return null;
      }

      const { code: revokeCode } = generateHumanCode(0);
      row.status = PtPlayerConsentStatus.APPROVED;
      row.decidedAt = new Date();
      row.reviewCode = null;
      row.reviewCodeExpiresAt = null;
      row.revokeCode = revokeCode;
      await repository.save(row);

      return row;
    });

    if (!result) return null;

    const player = await this.playersService.findById(result.playerId);
    const ptStaffAccount = await this.staffAccountRepository.findOne({
      where: { id: result.ptStaffAccountId },
    });
    const ptDisplayName =
      ptStaffAccount?.displayName ?? ptStaffAccount?.email ?? '';

    if (player && result.revokeCode) {
      await this.sendApprovedEmailBestEffort(
        player.screenName,
        player.locale,
        result.recipientContactSnapshot,
        ptDisplayName,
        result.revokeCode,
      );
    }

    return { ptDisplayName };
  }

  /** The POST side — decline. No revoke code needed (nothing was ever
   * granted). Same friendly no-op idiom as approveByReviewCode. */
  async declineByReviewCode(code: string): Promise<{ declined: true } | null> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(PtPlayerConsent);
      const row = await repository
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.review_code = :code', { code })
        .getOne();
      if (
        !row ||
        row.status !== PtPlayerConsentStatus.PENDING_REVIEW ||
        !isReviewCodeLive(row)
      ) {
        return null;
      }
      row.status = PtPlayerConsentStatus.DECLINED;
      row.decidedAt = new Date();
      row.reviewCode = null;
      row.reviewCodeExpiresAt = null;
      await repository.save(row);
      return { declined: true };
    });
  }

  // --- Revocation lever 2: the non-expiring mailed revoke link --------------

  /** GET-side preview for the revoke link — no side effects. */
  async previewByRevokeCode(code: string): Promise<{
    screenName: string;
    ptDisplayName: string;
  } | null> {
    const row = await this.ptPlayerConsentRepository.findOne({
      where: { revokeCode: code, status: PtPlayerConsentStatus.APPROVED },
    });
    if (!row) return null;
    const player = await this.playersService.findById(row.playerId);
    if (!player) return null;
    const ptStaffAccount = await this.staffAccountRepository.findOne({
      where: { id: row.ptStaffAccountId },
    });
    return {
      screenName: player.screenName,
      ptDisplayName: ptStaffAccount?.displayName ?? ptStaffAccount?.email ?? '',
    };
  }

  /**
   * docs/adr/0023 Decision A4 point 2 — the parent's (or self-verifying
   * player's) own non-expiring revocation lever. Same friendly no-op idiom
   * for "already revoked / no such code."
   */
  async revokeByRevokeCode(code: string): Promise<{ revoked: true } | null> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(PtPlayerConsent);
      const row = await repository
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.revoke_code = :code', { code })
        .andWhere('c.status = :status', {
          status: PtPlayerConsentStatus.APPROVED,
        })
        .getOne();
      if (!row) return null;
      row.status = PtPlayerConsentStatus.REVOKED;
      row.revokedAt = new Date();
      row.revokedReason = PtPlayerConsentRevokedReason.PARENT_OR_PLAYER_REVOKED;
      await repository.save(row);
      return { revoked: true };
    });
  }

  // --- Revocation lever 1: the player's own in-app self-service -------------

  /**
   * docs/adr/0023 Decision A4 point 1 — the player themself, in-app,
   * self-service, no parent needed. Ownership-checked: `consentId` must
   * belong to the calling `playerId`, else a generic 404 (deliberately not
   * distinguishing "no such id" from "not yours", same posture as every
   * other ownership-checked mailed/self-service action in this app).
   */
  /**
   * The player's own list of PT relationships, for Screen PL1
   * (docs/design/phase8-pt-flows.md §7).
   *
   * Added 2026-08-09, after the Phase 8 design pass found the gap: ADR-0023
   * Decision A4 gives the child an unconditional, immediate,
   * no-parent-needed revocation lever, and shipped it as
   * `POST .../pt-consents/:id/revoke` — but nothing ever let the child see
   * *what* to revoke. A lever with no dial is not self-determination, so
   * the read side is part of A4's intent rather than an addition to it.
   *
   * Exposes only this player's own relationships, and only the counterparty
   * they already know about by definition (the PT who asked for them). It
   * is deliberately NOT the mirror of A5's "a PT never learns a player's
   * other PT relationships" rule — that rule protects the child from one
   * PT learning about another, and says nothing about the child's own view
   * of their own life.
   *
   * `declined`/`expired` rows are omitted: they represent a relationship
   * that never existed, and listing them would show a child a stream of
   * requests their parent quietly turned down.
   */
  async listOwnConsents(playerId: string): Promise<PtConsentSummary[]> {
    const rows = await this.ptPlayerConsentRepository.find({
      where: {
        playerId,
        status: In([
          PtPlayerConsentStatus.PENDING_REVIEW,
          PtPlayerConsentStatus.APPROVED,
          PtPlayerConsentStatus.REVOKED,
        ]),
      },
      order: { createdAt: 'DESC' },
    });
    if (rows.length === 0) return [];

    const staffAccounts = await this.staffAccountRepository.find({
      where: { id: In(rows.map((row) => row.ptStaffAccountId)) },
    });
    const nameById = new Map(
      staffAccounts.map((account) => [
        account.id,
        account.displayName ?? account.email,
      ]),
    );

    return rows.map((row) => ({
      id: row.id,
      // Falls back to the email only if a provider gave us no display name
      // (Apple, for accounts created before it withheld one) — never null,
      // since an unnamed row is unactionable for a child deciding whether
      // to end it.
      ptDisplayName: nameById.get(row.ptStaffAccountId) ?? '—',
      status: row.status,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
    }));
  }

  async playerSelfRevoke(
    playerId: string,
    consentId: string,
  ): Promise<{ revoked: true }> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(PtPlayerConsent);
      const row = await repository
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.id = :consentId', { consentId })
        .andWhere('c.player_id = :playerId', { playerId })
        .andWhere('c.status IN (:...statuses)', {
          statuses: [
            PtPlayerConsentStatus.PENDING_REVIEW,
            PtPlayerConsentStatus.APPROVED,
          ],
        })
        .getOne();
      if (!row) {
        throw new PtPlayerConsentNotFoundException();
      }
      row.status = PtPlayerConsentStatus.REVOKED;
      row.revokedAt = new Date();
      row.revokedReason = PtPlayerConsentRevokedReason.PARENT_OR_PLAYER_REVOKED;
      // A pending (not yet decided) request revoked by the player before
      // any parent action — clear the review code too so a stale mailed
      // link can't still be used to approve a now-revoked request.
      row.reviewCode = null;
      row.reviewCodeExpiresAt = null;
      await repository.save(row);
      return { revoked: true };
    });
  }

  // --- Email (best-effort, never blocks/throws) -----------------------------

  private async sendRequestEmailBestEffort(
    screenName: string,
    locale: PlayerLocale,
    isSelfVerification: boolean,
    parentContact: string | null,
    ptDisplayName: string,
    ptEmail: string,
    reviewCode: string,
  ): Promise<void> {
    if (!parentContact) {
      this.logger.warn(
        'No parent contact on file to send the PT consent-request email to — the request still exists, but nobody was notified.',
      );
      return;
    }
    try {
      const reviewUrl = `${this.appPublicUrl()}/api/v1/pt-consent/${reviewCode}`;
      const email = buildPtConsentRequestEmail({
        screenName,
        isSelfVerification,
        ptDisplayName,
        ptEmail,
        reviewUrl,
        expiresInDays: Math.round(
          PT_CONSENT_REVIEW_CODE_TTL_MS / (24 * 60 * 60 * 1000),
        ),
        locale,
      });
      await this.mailService.sendMail({
        to: parentContact,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to send PT consent-request email: ${message}`);
    }
  }

  private async sendApprovedEmailBestEffort(
    screenName: string,
    locale: PlayerLocale,
    recipientContactSnapshot: string | null,
    ptDisplayName: string,
    revokeCode: string,
  ): Promise<void> {
    if (!recipientContactSnapshot) {
      this.logger.warn(
        'No recipient snapshot on file to send the PT consent-approved email to.',
      );
      return;
    }
    try {
      const recipient = decryptPii(
        recipientContactSnapshot,
        this.encryptionKey,
      );
      const revokeUrl = `${this.appPublicUrl()}/api/v1/pt-consent-revoke/${revokeCode}`;
      const email = buildPtConsentApprovedEmail({
        screenName,
        ptDisplayName,
        revokeUrl,
        locale,
      });
      await this.mailService.sendMail({
        to: recipient,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to send PT consent-approved email: ${message}`);
    }
  }
}

function isReviewCodeLive(row: PtPlayerConsent): boolean {
  return (
    row.reviewCodeExpiresAt !== null &&
    row.reviewCodeExpiresAt.getTime() > Date.now()
  );
}
