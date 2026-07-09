import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  CaptainConsentRequiredException,
  CaptainTransferConflictException,
  CaptainTransferTargetNotOnTeamException,
  CaptainTransferToSelfException,
  NotTeamCaptainException,
  PlayerNotFoundException,
  TeamMismatchException,
} from '../common/errors/exceptions';
import { isPostgresUniqueViolation } from '../common/errors/postgres-error.util';
import { ParentalConsentStatus } from './player-consent-status.enum';
import { Player } from './entities/player.entity';

const ONE_CAPTAIN_PER_TEAM_CONSTRAINT = 'idx_player_one_captain_per_team';

export interface CreatePlayerShellInput {
  teamId: string;
  screenName: string;
  avatarId: string;
  birthYear: number;
  // docs/adr/0009-self-service-team-creation.md's Server-side algorithm —
  // true for exactly one call site (OnboardingService.createPlayer, only
  // when this exact request just created the team); every other existing
  // caller omits it, which defaults to false, unchanged.
  isCaptain?: boolean;
}

export interface CaptainTransferResult {
  teamId: string;
  previousCaptainPlayerId: string;
  newCaptainPlayerId: string;
  transferredAt: Date;
}

export interface TeammateEntry {
  playerId: string;
  screenName: string;
  avatarId: string;
  isCaptain: boolean;
}

// Deliberately never imports anything from PlayerPrivateInfoModule — this
// is the hard module-boundary requirement from
// docs/adr/0002-data-model.md's 2026-07-03 addendum §1. Every query here is
// safe to reuse for a leaderboard/feed/badge feature later, because this
// table structurally cannot carry real_name/parent_contact.
@Injectable()
export class PlayersService {
  constructor(
    private readonly dataSource: DataSource,
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
      isCaptain: input.isCaptain ?? false,
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

  /** All players on a team — backs the Phase 2 roster/dashboard endpoints
   * (docs/api/phase2-contract.md). Safe by construction: Player carries no
   * real_name/parent_contact (those live in PlayerPrivateInfo), so this is
   * not a privacy-sensitive bulk read. */
  async listByTeam(teamId: string): Promise<Player[]> {
    return this.playerRepository.find({ where: { teamId } });
  }

  /**
   * Team-scoped-by-path-param check (docs/api/phase2-contract.md's
   * Conventions section): the requesting player must belong to the team
   * named in the URL. Shared by every Phase 2 team-scoped endpoint so the
   * check lives in exactly one place, per that doc's implementer note.
   */
  async assertTeamMembership(
    playerId: string,
    teamId: string,
  ): Promise<Player> {
    const player = await this.findByIdOrThrow(playerId);
    if (player.teamId !== teamId) {
      throw new TeamMismatchException();
    }
    return player;
  }

  /**
   * The captain check (ADR-0005 Decision 1: "no new CaptainGuard class,
   * a service-layer check is enough"). Layers on top of
   * assertTeamMembership rather than duplicating the team lookup.
   *
   * Also requires the *acting* captain's own parentalConsentStatus to be
   * approved (docs/ACTION_PLAN.md's Phase 2.9 section, prompted by
   * docs/adr/0009-self-service-team-creation.md's flagged risk #1): before
   * self-service team creation, every captain reaching this check already
   * had approved consent by construction (a seed captain's consent is
   * pre-approved; an ADR-0006 transfer target is always already-onboarded)
   * — so this was previously a no-op distinction. A self-created team's
   * captain is the first realistic case where that's no longer true (their
   * own consent can still be `pending` immediately after the onboarding
   * shell commits), so it's checked explicitly now rather than assumed.
   */
  async assertIsCaptainOfTeam(
    playerId: string,
    teamId: string,
  ): Promise<Player> {
    const player = await this.assertTeamMembership(playerId, teamId);
    if (!player.isCaptain) {
      throw new NotTeamCaptainException();
    }
    if (player.parentalConsentStatus !== ParentalConsentStatus.APPROVED) {
      throw new CaptainConsentRequiredException();
    }
    return player;
  }

  /**
   * ADR-0006 Decision 1 — self-service captain handoff, the current
   * captain's own action, targeting a named teammate. No new guard class;
   * this *is* the concurrency-sensitive authorization boundary (see the
   * ADR's "Transaction shape" section), not just a column update, so the
   * captain check happens *inside* the transaction, under a row lock, not
   * just via assertIsCaptainOfTeam beforehand.
   *
   * Fixed lock order on every call — requester row, then target row — is
   * what prevents two concurrent transfer attempts from the same (still-)
   * captain from deadlocking on each other; they serialize on the
   * requester's own row lock instead. Re-checking `requester.isCaptain`
   * after acquiring that lock (not trusting the caller's JWT-derived
   * assumption) is what closes the race: a transfer that loses the
   * serialization order sees `isCaptain: false` under its own lock and
   * fails with `not_team_captain`, rather than racing the unique index
   * below.
   */
  async transferCaptaincy(
    teamId: string,
    requesterId: string,
    newCaptainPlayerId: string,
  ): Promise<CaptainTransferResult> {
    return this.dataSource.transaction(async (manager) => {
      const requester = await this.findByIdForUpdate(manager, requesterId);
      if (requester.teamId !== teamId) {
        throw new TeamMismatchException();
      }
      if (!requester.isCaptain) {
        throw new NotTeamCaptainException();
      }
      // Same acting-captain consent gate as assertIsCaptainOfTeam (see its
      // comment) — transferCaptaincy does its own inline captain check
      // (row-locked, not via assertIsCaptainOfTeam) so this needs its own
      // copy of the same rule.
      if (requester.parentalConsentStatus !== ParentalConsentStatus.APPROVED) {
        throw new CaptainConsentRequiredException();
      }
      if (newCaptainPlayerId === requesterId) {
        throw new CaptainTransferToSelfException();
      }

      // findByIdForUpdate already throws PlayerNotFoundException if
      // newCaptainPlayerId doesn't exist at all.
      const target = await this.findByIdForUpdate(manager, newCaptainPlayerId);
      if (target.teamId !== teamId) {
        throw new CaptainTransferTargetNotOnTeamException();
      }

      const repository = manager.getRepository(Player);
      requester.isCaptain = false;
      await repository.save(requester);
      target.isCaptain = true;
      try {
        await repository.save(target);
      } catch (error) {
        if (isPostgresUniqueViolation(error, ONE_CAPTAIN_PER_TEAM_CONSTRAINT)) {
          // Should be unreachable given the locks above — kept as a
          // backstop, same posture as WeeklyGoalService's equivalent catch
          // for idx_challenge_one_active_goal_per_team.
          throw new CaptainTransferConflictException();
        }
        throw error;
      }

      return {
        teamId,
        previousCaptainPlayerId: requester.id,
        newCaptainPlayerId: target.id,
        transferredAt: new Date(),
      };
    });
  }

  /**
   * ADR-0006 Decision 2 — "who's on my team, who's captain," open to any
   * teammate (team-membership check only, not captain-gated). Deliberately
   * narrower than listByTeam's captain-only consumers (roster): only
   * playerId/screenName/avatarId/isCaptain, per the contract's "nothing
   * else" — no consentStatus/lastTrainedDate here.
   */
  async listTeammates(
    teamId: string,
    requesterId: string,
  ): Promise<TeammateEntry[]> {
    await this.assertTeamMembership(requesterId, teamId);
    const players = await this.listByTeam(teamId);
    return players.map((player) => ({
      playerId: player.id,
      screenName: player.screenName,
      avatarId: player.avatarId,
      isCaptain: player.isCaptain,
    }));
  }

  /**
   * ADR-0004 Part 3: the transactional write behind
   * POST /players/:playerId/session-reissue — bumps token_version
   * (invalidating every existing token for this player immediately) and
   * stores a fresh session-reissue code + expiry in the same statement.
   * Always takes a manager and the *new* tokenVersion explicitly (the
   * caller has already read the current value under a row lock via
   * findByIdForUpdate) rather than an atomic `+ 1` here, so the same
   * pessimistic-write lock that guarantees "read current, then write
   * current+1" is uncontended for the whole operation.
   */
  async setSessionReissueCode(
    manager: EntityManager,
    playerId: string,
    fields: {
      newTokenVersion: number;
      code: string;
      expiresAt: Date;
    },
  ): Promise<void> {
    await manager.getRepository(Player).update(
      { id: playerId },
      {
        tokenVersion: fields.newTokenVersion,
        sessionReissueCode: fields.code,
        sessionReissueCodeExpiresAt: fields.expiresAt,
      },
    );
  }

  /**
   * Row-locked lookup by session-reissue code, for use inside
   * SessionService.redeem's transaction — same "lock, then check
   * liveness" shape as approveByConsentToken. Returns null for both "no
   * such code" and "expired," deliberately not distinguished (mirrors the
   * consent-token lookup's reasoning), per ADR-0004 Part 3's generic
   * invalid_or_expired_code error.
   */
  async findValidBySessionReissueCode(
    manager: EntityManager,
    code: string,
  ): Promise<Player | null> {
    const player = await manager
      .getRepository(Player)
      .createQueryBuilder('player')
      .setLock('pessimistic_write')
      .where('player.session_reissue_code = :code', { code })
      .getOne();
    if (!player || !isSessionReissueCodeLive(player)) {
      return null;
    }
    return player;
  }

  /** Single-use: nulls the code (and its expiry) once redeemed. */
  async clearSessionReissueCode(
    manager: EntityManager,
    playerId: string,
  ): Promise<void> {
    await manager
      .getRepository(Player)
      .update(
        { id: playerId },
        { sessionReissueCode: null, sessionReissueCodeExpiresAt: null },
      );
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

function isSessionReissueCodeLive(player: Player): boolean {
  return (
    player.sessionReissueCodeExpiresAt !== null &&
    player.sessionReissueCodeExpiresAt.getTime() > Date.now()
  );
}
