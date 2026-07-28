import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
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
    const info = await this.privateInfoRepository.findOne({
      where: { playerId },
    });
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
    const info = await this.privateInfoRepository.findOne({
      where: { playerId },
    });
    if (!info) return null;
    return decryptPii(info.parentContact, this.encryptionKey);
  }
}
