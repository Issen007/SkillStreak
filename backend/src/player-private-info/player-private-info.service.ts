import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
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
@Injectable()
export class PlayerPrivateInfoService {
  constructor(
    @InjectRepository(PlayerPrivateInfo)
    private readonly privateInfoRepository: Repository<PlayerPrivateInfo>,
    @InjectRepository(ParentalConsentRecord)
    private readonly consentRecordRepository: Repository<ParentalConsentRecord>,
  ) {}

  async createForNewPlayer(
    manager: EntityManager,
    playerId: string,
    parentContact: string,
    realName?: string,
  ): Promise<void> {
    const repository = manager.getRepository(PlayerPrivateInfo);
    await repository.save(
      repository.create({
        playerId,
        parentContact,
        realName: realName ?? null,
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
    return info?.realName ?? null;
  }
}
