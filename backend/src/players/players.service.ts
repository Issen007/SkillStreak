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

  /**
   * Looks up a player by screen name — the identity field every
   * player-facing surface already shows, so this carries no boundary risk
   * (unlike anything in PlayerPrivateInfo). Screen names are only unique
   * *within* a team (see the (team_id, screen_name) index), so this returns
   * the first match; fine for its current callers (an admin/test script
   * that already knows there's exactly one), not intended as a
   * cross-team search API.
   */
  async findByScreenName(screenName: string): Promise<Player | null> {
    return this.playerRepository.findOne({ where: { screenName } });
  }

  /**
   * Persists a freshly generated consent-approval token (see
   * ../players/consent-token.util.ts for generation) onto the player row.
   * Always takes a manager — callers that aren't already inside a
   * transaction (e.g. the send-test-consent-email script) can pass
   * `dataSource.manager` or wrap a single-statement transaction themselves.
   */
  async setConsentToken(
    manager: EntityManager,
    playerId: string,
    token: string,
    expiresAt: Date,
  ): Promise<void> {
    await manager
      .getRepository(Player)
      .update(
        { id: playerId },
        { consentToken: token, consentTokenExpiresAt: expiresAt },
      );
  }

  /**
   * Read-only lookup for the GET consent-preview endpoint — deliberately
   * has no side effects (see ConsentController's comment on why: email
   * clients/security scanners prefetch links, and a mutating GET would
   * auto-approve consent without a human ever clicking anything). Returns
   * null for both "no such token" and "expired" — callers must not
   * distinguish the two in what they show the caller, so as not to leak
   * whether a token almost existed.
   */
  async findValidByConsentToken(token: string): Promise<Player | null> {
    const player = await this.playerRepository.findOne({
      where: { consentToken: token },
    });
    if (!player || !isConsentTokenLive(player)) {
      return null;
    }
    return player;
  }

  /**
   * The actual approval write: looks up by token under a row lock (so two
   * near-simultaneous POSTs to the same token can't both succeed), checks
   * it's not null/expired, flips parental_consent_status to approved, and
   * clears the token to null — null-out-on-use is the single-use
   * mechanism, no separate "used" flag needed. Returns null if the token
   * was already invalid/expired/consumed, which the caller (ConsentService)
   * renders as a friendly "already confirmed" page rather than an error.
   */
  async approveByConsentToken(
    manager: EntityManager,
    token: string,
  ): Promise<Player | null> {
    const repository = manager.getRepository(Player);
    const player = await repository
      .createQueryBuilder('player')
      .setLock('pessimistic_write')
      .where('player.consent_token = :token', { token })
      .getOne();

    if (!player || !isConsentTokenLive(player)) {
      return null;
    }

    player.parentalConsentStatus = ParentalConsentStatus.APPROVED;
    player.consentToken = null;
    player.consentTokenExpiresAt = null;
    return repository.save(player);
  }
}

function isConsentTokenLive(player: Player): boolean {
  return (
    player.consentTokenExpiresAt !== null &&
    player.consentTokenExpiresAt.getTime() > Date.now()
  );
}
