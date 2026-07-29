import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { decryptPii, encryptPii } from '../common/crypto/pii-encryption.util';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import {
  ConsentMethod,
  ParentalConsentRecord,
} from './entities/parental-consent-record.entity';
import { PlayerPrivateInfo } from './entities/player-private-info.entity';

// The ONLY module allowed to import PlayerPrivateInfo/ParentalConsentRecord
// entities/repositories, per docs/adr/0002-data-model.md's 2026-07-03
// addendum §1. It exposes narrow, purpose-specific methods only:
//  - createForNewPlayer / recordConsentEvent: the consent flow (onboarding).
//  - getRealName: the (not-yet-built) coach-only admin view.
// Nothing here returns parent_contact/real_name in bulk or as part of any
// player-facing/leaderboard-shaped query.
//
// Fas 4 encryption-at-rest, 2026-07-28 — being the sole gatekeeper for
// these two columns (already true per the ADR addendum above) is exactly
// what makes it the right, and only, place to encrypt on write and
// decrypt on read: every caller in this codebase already goes through
// this service, so nothing needs to change anywhere else. See
// common/crypto/pii-encryption.util.ts for why this is application-level
// AES-256-GCM, not Postgres' pgcrypto, and the
// EncryptPlayerPrivateInfo1785200000000 migration for the one-time
// backfill of rows that predate this change.
@Injectable()
export class PlayerPrivateInfoService {
  constructor(
    @InjectRepository(PlayerPrivateInfo)
    private readonly privateInfoRepository: Repository<PlayerPrivateInfo>,
    @InjectRepository(ParentalConsentRecord)
    private readonly consentRecordRepository: Repository<ParentalConsentRecord>,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  private get encryptionKey(): string {
    return this.configService.getOrThrow<string>('PII_ENCRYPTION_KEY');
  }

  async createForNewPlayer(
    manager: EntityManager,
    playerId: string,
    parentContact: string,
    realName?: string,
  ): Promise<void> {
    const key = this.encryptionKey;
    const repository = manager.getRepository(PlayerPrivateInfo);
    await repository.save(
      repository.create({
        playerId,
        parentContact: encryptPii(parentContact, key),
        realName: realName ? encryptPii(realName, key) : null,
      }),
    );
  }

  async recordConsentEvent(
    manager: EntityManager,
    playerId: string,
    status: ParentalConsentStatus,
    method: ConsentMethod,
  ): Promise<void> {
    const repository = manager.getRepository(ParentalConsentRecord);
    await repository.save(repository.create({ playerId, status, method }));
  }

  /**
   * Coach-only admin read path (gated by TeamCoach membership at the
   * controller layer once that endpoint exists — Phase 2). No caller in
   * Phase 1 uses this; kept here, not on PlayersService, so the *only* way
   * to ever read real_name is through this module.
   */
  async getRealName(playerId: string): Promise<string | null> {
    const info = await this.getEffective(playerId);
    if (!info?.realName) return null;
    return decryptPii(info.realName, this.encryptionKey);
  }

  /**
   * The other narrow read path this module exposes, per ADR-0002 addendum
   * §1: "the consent-flow service (reads/writes parent_contact)". Used by
   * the send-test-consent-email script, which needs to (re)send a consent
   * email to an existing player without going through the full onboarding
   * flow (which already has parentContact from the request body and
   * doesn't need to read it back).
   */
  async getParentContact(playerId: string): Promise<string | null> {
    const info = await this.getEffective(playerId);
    if (!info) return null;
    return decryptPii(info.parentContact, this.encryptionKey);
  }

  /**
   * docs/adr/0012-profile-page-and-contact-email-change.md decision 4 —
   * the profile page's real-name edit. No confirmation flow (unlike the
   * contact-email change below): there's no account-recovery implication
   * to a display name.
   */
  async updateRealName(
    playerId: string,
    realName: string | null,
  ): Promise<void> {
    await this.privateInfoRepository.update(
      { playerId },
      { realName: realName ? encryptPii(realName, this.encryptionKey) : null },
    );
  }

  /**
   * docs/adr/0012-profile-page-and-contact-email-change.md decision 1,
   * step 1 — stores the candidate new contact (encrypted, same as the
   * live column) plus the confirmation code, inside the same transaction
   * SessionService.performReissue uses for the analogous session-reissue
   * write (row-locked read, then write, so a concurrent request can't
   * race past the cooldown check the caller already did).
   */
  async setPendingContactChange(
    manager: EntityManager,
    playerId: string,
    fields: { pendingContact: string; code: string; expiresAt: Date },
  ): Promise<void> {
    await manager.getRepository(PlayerPrivateInfo).update(
      { playerId },
      {
        pendingParentContact: encryptPii(
          fields.pendingContact,
          this.encryptionKey,
        ),
        contactChangeCode: fields.code,
        contactChangeCodeExpiresAt: fields.expiresAt,
      },
    );
  }

  /**
   * Row-locked lookup by contact-change code, for use inside
   * ProfileService.confirmContactChange's transaction — same "lock, then
   * check liveness" shape as PlayersService.findValidBySessionReissueCode.
   * Returns null for both "no such code" and "expired," deliberately not
   * distinguished (same reasoning as session reissue's identical
   * generic-error posture).
   */
  async findValidByContactChangeCode(
    manager: EntityManager,
    code: string,
  ): Promise<PlayerPrivateInfo | null> {
    const info = await manager
      .getRepository(PlayerPrivateInfo)
      .createQueryBuilder('info')
      .setLock('pessimistic_write')
      .where('info.contact_change_code = :code', { code })
      .getOne();
    if (!info || !isContactChangeCodeLive(info)) {
      return null;
    }
    return info;
  }

  /**
   * security-reviewer finding, 2026-07-28 — confirming the new-address
   * code no longer applies the change immediately. This starts a grace
   * period instead: consumes contactChangeCode (single-use, same as
   * before), and sets contactChangeApplyAt + a freshly-generated
   * contactChangeCancelCode (emailed to the OLD address by
   * ProfileService, the caller). pendingParentContact is left untouched
   * — still queued, applied lazily once due (see getEffective) or
   * discarded entirely by cancelPendingContactChange.
   */
  async startContactChangeGracePeriod(
    manager: EntityManager,
    playerId: string,
    fields: { applyAt: Date; cancelCode: string },
  ): Promise<void> {
    await manager.getRepository(PlayerPrivateInfo).update(
      { playerId },
      {
        contactChangeCode: null,
        contactChangeCodeExpiresAt: null,
        contactChangeApplyAt: fields.applyAt,
        contactChangeCancelCode: fields.cancelCode,
      },
    );
  }

  /**
   * Row-locked lookup by cancel code. Unlike findValidByContactChangeCode,
   * "liveness" here means the grace period hasn't elapsed yet — if it
   * has, the change is due (or already applied by a concurrent read via
   * getEffective) and cancellation is too late, per the ADR addendum's
   * design.
   */
  async findValidByCancelCode(
    manager: EntityManager,
    code: string,
  ): Promise<PlayerPrivateInfo | null> {
    const info = await manager
      .getRepository(PlayerPrivateInfo)
      .createQueryBuilder('info')
      .setLock('pessimistic_write')
      .where('info.contact_change_cancel_code = :code', { code })
      .getOne();
    if (!info || !isGracePeriodStillOpen(info)) {
      return null;
    }
    return info;
  }

  /**
   * Unlocked read for GET /players/contact-change-cancel/:code — same
   * "no side effects on GET" requirement as ConsentService.previewByToken
   * (email clients/security scanners prefetch links), so this
   * deliberately doesn't take a lock the way findValidByCancelCode does.
   */
  async previewByCancelCode(code: string): Promise<PlayerPrivateInfo | null> {
    const info = await this.privateInfoRepository.findOne({
      where: { contactChangeCancelCode: code },
    });
    if (!info || !isGracePeriodStillOpen(info)) {
      return null;
    }
    return info;
  }

  /**
   * The old address holder saying "this wasn't me" — discards the
   * pending change entirely, without ever applying it. Deliberately
   * clears every pending field (not just pendingParentContact) so a
   * stale contactChangeCancelCode can't be reused, mirroring
   * applyPendingContactChange's single-use posture.
   */
  async cancelPendingContactChange(
    manager: EntityManager,
    playerId: string,
  ): Promise<void> {
    await manager.getRepository(PlayerPrivateInfo).update(
      { playerId },
      {
        pendingParentContact: null,
        contactChangeApplyAt: null,
        contactChangeCancelCode: null,
      },
    );
  }

  /**
   * Moves the already-encrypted pending value into the live column
   * directly (no decrypt/re-encrypt round trip needed — it's already
   * ciphertext in the right format) and clears every pending field.
   * Called only from getEffective, once the grace period is actually due
   * — never directly by a controller/service, unlike Part 3's original
   * (pre-addendum) design.
   */
  private async applyPendingContactChange(
    manager: EntityManager,
    playerId: string,
    pendingContactCiphertext: string,
  ): Promise<void> {
    await manager.getRepository(PlayerPrivateInfo).update(
      { playerId },
      {
        parentContact: pendingContactCiphertext,
        pendingParentContact: null,
        contactChangeApplyAt: null,
        contactChangeCancelCode: null,
      },
    );
  }

  /**
   * docs/adr/0013-account-erasure.md Decision 2's blocking security-reviewer
   * fix — a direct, raw read of `pendingParentContact IS NOT NULL`,
   * deliberately NOT going through getEffective(), so this check itself can
   * never trigger the very lazy-apply side effect it exists to catch ahead
   * of (calling getEffective() here would apply a due-but-not-yet-applied
   * pending change as a side effect of merely checking for one, which is
   * exactly the state this method must observe, not resolve). Used by
   * AccountErasureService.requestErasure to refuse a new erasure request
   * outright (409) while any contact-change — still within its own 24h
   * window, or already past due but not yet lazily applied by some other
   * read — is unresolved.
   */
  async hasPendingContactChange(playerId: string): Promise<boolean> {
    const info = await this.privateInfoRepository.findOne({
      where: { playerId },
    });
    return info?.pendingParentContact != null;
  }

  /**
   * The read path every getter above goes through: if a confirmed
   * contact change's grace period has elapsed, applies it inline (in its
   * own short transaction, row-locked) before returning — a lazy
   * "apply-on-next-read" rather than a scheduled sweep, appropriate at
   * this app's scale (mirrors this codebase's general preference for the
   * boring option over new cron infrastructure when one isn't already
   * needed for something else). A player who never gets read again after
   * the grace period simply never gets the lazy flip, which is safe by
   * construction (their old contact just keeps being the one this app
   * uses), not a correctness bug.
   */
  private async getEffective(
    playerId: string,
  ): Promise<PlayerPrivateInfo | null> {
    const info = await this.privateInfoRepository.findOne({
      where: { playerId },
    });
    if (!info) return null;
    if (!isChangeDue(info)) return info;

    return this.dataSource.transaction(async (manager) => {
      const locked = await manager
        .getRepository(PlayerPrivateInfo)
        .createQueryBuilder('info')
        .setLock('pessimistic_write')
        .where('info.player_id = :playerId', { playerId })
        .getOne();
      // Re-check under the lock — a concurrent request may have already
      // applied (or cancelled) it between the unlocked read above and
      // this transaction starting.
      if (!locked || !isChangeDue(locked) || !locked.pendingParentContact) {
        return locked;
      }
      await this.applyPendingContactChange(
        manager,
        playerId,
        locked.pendingParentContact,
      );
      return {
        ...locked,
        parentContact: locked.pendingParentContact,
        pendingParentContact: null,
        contactChangeApplyAt: null,
        contactChangeCancelCode: null,
      };
    });
  }
}

function isContactChangeCodeLive(info: PlayerPrivateInfo): boolean {
  return (
    info.contactChangeCodeExpiresAt !== null &&
    info.contactChangeCodeExpiresAt.getTime() > Date.now()
  );
}

function isGracePeriodStillOpen(info: PlayerPrivateInfo): boolean {
  return (
    info.contactChangeApplyAt !== null &&
    info.contactChangeApplyAt.getTime() > Date.now()
  );
}

function isChangeDue(info: PlayerPrivateInfo): boolean {
  return (
    info.contactChangeApplyAt !== null &&
    info.contactChangeApplyAt.getTime() <= Date.now()
  );
}
