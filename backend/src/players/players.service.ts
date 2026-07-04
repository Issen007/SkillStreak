import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { PlayerNotFoundException } from '../common/errors/exceptions';
import { ParentalConsentStatus } from './player-consent-status.enum';
import { Player } from './entities/player.entity';

export interface CreatePlayerShellInput {
  teamId: string;
  screenName: string;
  avatarId: string;
  birthYear: number;
}

// Deliberately never imports anything from PlayerPrivateInfoModule — this
// is the hard module-boundary requirement from
// docs/adr/0002-data-model.md's 2026-07-03 addendum §1. Every query here is
// safe to reuse for a leaderboard/feed/badge feature later, because this
// table structurally cannot carry real_name/parent_contact.
@Injectable()
export class PlayersService {
  constructor(
    @InjectRepository(Player)
    private readonly playerRepository: Repository<Player>,
  ) {}

  /** Creates the onboarding "shell" row — see docs/adr/0002 addendum §2. */
  async createShell(
    manager: EntityManager,
    input: CreatePlayerShellInput,
  ): Promise<Player> {
    const repository = manager.getRepository(Player);
    const player = repository.create({
      teamId: input.teamId,
      screenName: input.screenName,
      avatarId: input.avatarId,
      birthYear: input.birthYear,
      parentalConsentStatus: ParentalConsentStatus.PENDING,
    });
    return repository.save(player);
  }

  async findById(
    playerId: string,
    manager?: EntityManager,
  ): Promise<Player | null> {
    const repository = manager
      ? manager.getRepository(Player)
      : this.playerRepository;
    return repository.findOne({ where: { id: playerId } });
  }

  async findByIdOrThrow(
    playerId: string,
    manager?: EntityManager,
  ): Promise<Player> {
    const player = await this.findById(playerId, manager);
    if (!player) {
      throw new PlayerNotFoundException();
    }
    return player;
  }

  /**
   * Reads the player row with a row-level lock, for use inside a write
   * transaction (training-log creation) to serialize concurrent same-day
   * requests for the same player and avoid a lost streak update.
   */
  async findByIdForUpdate(
    manager: EntityManager,
    playerId: string,
  ): Promise<Player> {
    const player = await manager
      .getRepository(Player)
      .createQueryBuilder('player')
      .setLock('pessimistic_write')
      .where('player.id = :playerId', { playerId })
      .getOne();
    if (!player) {
      throw new PlayerNotFoundException();
    }
    return player;
  }

  async updateStreakFields(
    manager: EntityManager,
    playerId: string,
    fields: {
      currentStreakCount: number;
      longestStreakCount: number;
      lastTrainedDate: string;
    },
  ): Promise<void> {
    await manager.getRepository(Player).update({ id: playerId }, fields);
  }
}
