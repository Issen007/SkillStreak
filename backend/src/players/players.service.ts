import { Jurisdiction } from '../common/age/article8-age';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import {
  CaptainConsentRequiredException,
  CaptainTransferConflictException,
  CaptainTransferTargetMidErasureException,
  CaptainTransferTargetNotOnTeamException,
  CaptainTransferToSelfException,
  NotTeamCaptainException,
  PlayerNotFoundException,
  TeamJoinNotPendingException,
  TeamMismatchException,
} from '../common/errors/exceptions';
import { isPostgresUniqueViolation } from '../common/errors/postgres-error.util';
import { PlayerLocale } from '../common/locale/player-locale.enum';
import {
  AccountErasureRequest,
  AccountErasureStatus,
} from '../account-erasure/entities/account-erasure-request.entity';
import { ParentalConsentStatus } from './player-consent-status.enum';
import { TeamJoinStatus } from './team-join-status.enum';
import { Player } from './entities/player.entity';
import { StreakSaverEvent } from './entities/streak-saver-event.entity';
import { StreakSaverEventType } from './streak-saver-event-type.enum';

const ACTIVE_ERASURE_STATUSES = [
  AccountErasureStatus.REQUESTED,
  AccountErasureStatus.GRACE_PERIOD,
];

const ONE_CAPTAIN_PER_TEAM_CONSTRAINT = 'idx_player_one_captain_per_team';

export interface CreatePlayerShellInput {
  teamId: string;
  screenName: string;
  avatarId: string;
  birthYear: number;
  /** Copied from the team; null resolves to the strictest Article 8 age. */
  jurisdiction?: Jurisdiction | null;
  // docs/adr/0009-self-service-team-creation.md's Server-side algorithm —
  // true for exactly one call site (OnboardingService.createPlayer, only
  // when this exact request just created the team); every other existing
  // caller omits it, which defaults to false, unchanged.
  isCaptain?: boolean;
  // docs/adr/0014-multi-language-support.md Decision 1/2 — the submitted
  // (optional) CreatePlayerDto.locale. Omitted (not merely `undefined`
  // spread into the insert) when the caller doesn't supply one, same
  // "let the column's own DEFAULT apply" idiom this method already uses
  // for tokenVersion/currentStreakCount/etc. below.
  locale?: PlayerLocale;
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
    // docs/adr/0013-account-erasure.md Decision 4's "Module wiring" —
    // registered via this module's OWN TypeOrmModule.forFeature (see
    // players.module.ts), not by importing AccountErasureModule (which
    // would cycle, since that module already imports PlayersModule for
    // transferCaptaincy/findByIdForUpdate at execution time). Same
    // "register the entity directly" technique WeeklyGoalModule already
    // uses to avoid an equivalent cycle with TrainingLogsModule.
    @InjectRepository(AccountErasureRequest)
    private readonly accountErasureRequestRepository: Repository<AccountErasureRequest>,
  ) {}

  /** Creates the onboarding "shell" row — see docs/adr/0002 addendum §2. */
  async createShell(
    manager: EntityManager,
    input: CreatePlayerShellInput,
  ): Promise<Player> {
    const repository = manager.getRepository(Player);
    const isCaptain = input.isCaptain ?? false;
    const player = repository.create({
      teamId: input.teamId,
      screenName: input.screenName,
      avatarId: input.avatarId,
      birthYear: input.birthYear,
      jurisdiction: input.jurisdiction ?? null,
      parentalConsentStatus: ParentalConsentStatus.PENDING,
      isCaptain,
      // Added 2026-07-27: whoever's join created the team can't be
      // pending approval from themselves — isCaptain is true if and only
      // if this exact request just created the team (ADR-0009 Decision
      // 2/7, unchanged), so it's the same signal this needs.
      teamJoinStatus: isCaptain
        ? TeamJoinStatus.APPROVED
        : TeamJoinStatus.PENDING,
      // Key omitted entirely (not just `undefined`-valued) when
      // input.locale wasn't supplied, so the insert leaves the column out
      // and Postgres's own `DEFAULT 'sv'` applies — same idiom as every
      // other defaulted column this method leaves unset.
      ...(input.locale !== undefined ? { locale: input.locale } : {}),
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

  /** docs/adr/0012's addendum (2026-07-28) — profile-page avatar editing.
   * Not PII, no confirmation flow: same low-risk "direct write" posture
   * as PlayerPrivateInfoService.updateRealName. No server-side whitelist
   * against AVATAR_CATALOG, matching onboarding's own existing validation
   * posture for this field (see UpdateProfileDto). */
  async updateAvatarId(playerId: string, avatarId: string): Promise<void> {
    await this.playerRepository.update({ id: playerId }, { avatarId });
  }

  // docs/adr/0014-multi-language-support.md Consequences — Player.locale
  // becomes editable post-onboarding via ADR-0012's existing PATCH
  // /players/me/profile endpoint (ProfileService.updateLocale), same
  // direct-write posture as updateAvatarId above (a display/rendering
  // choice, not an account-recovery-adjacent field — no confirmation flow
  // needed).
  async updateLocale(playerId: string, locale: PlayerLocale): Promise<void> {
    await this.playerRepository.update({ id: playerId }, { locale });
  }

  /**
   * Persists a streak transition — `TrainingLogsService.logTraining`'s own
   * transaction, guarded by its existing `findByIdForUpdate` row lock (see
   * that service's comment). `streakSaverEvents` is optional purely so
   * this method's shape stays backward-compatible for any future caller
   * that has nothing to report; `logTraining` always passes it, even when
   * both counts are zero/false, since that's still a real (empty)
   * transition, not an omission.
   *
   * docs/adr/0024-streak-savers.md Decision 4/5 — writes one `spent`
   * `StreakSaverEvent` row per covered date (chronological order, so
   * `bankedBalanceAfter` decreases one saver at a time and reads naturally
   * as a history), then one `earned` row if a saver was earned this log.
   * "One row per saver, not one row per resolution" per that Decision.
   */
  async updateStreakFields(
    manager: EntityManager,
    playerId: string,
    fields: {
      currentStreakCount: number;
      longestStreakCount: number;
      lastTrainedDate: string;
      bankedStreakSaverCount: number;
    },
    streakSaverEvents?: {
      trainingLogEntryId: string;
      bankedStreakSaverCountBefore: number;
      /** Chronological (oldest first) — one `spent` row written per date. */
      coveredDates: string[];
      streakSaverEarned: boolean;
    },
  ): Promise<void> {
    await manager.getRepository(Player).update({ id: playerId }, fields);

    if (!streakSaverEvents) {
      return;
    }

    const repository = manager.getRepository(StreakSaverEvent);
    let runningBalance = streakSaverEvents.bankedStreakSaverCountBefore;
    for (const coveredDate of streakSaverEvents.coveredDates) {
      runningBalance -= 1;
      await repository.save(
        repository.create({
          playerId,
          eventType: StreakSaverEventType.SPENT,
          bankedBalanceAfter: runningBalance,
          coveredDate,
          resolvedByTrainingLogEntryId: streakSaverEvents.trainingLogEntryId,
        }),
      );
    }

    if (streakSaverEvents.streakSaverEarned) {
      await repository.save(
        repository.create({
          playerId,
          eventType: StreakSaverEventType.EARNED,
          bankedBalanceAfter: fields.bankedStreakSaverCount,
          trainingLogEntryId: streakSaverEvents.trainingLogEntryId,
        }),
      );
    }
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
    return this.dataSource.transaction((manager) =>
      this.flipCaptaincy(manager, teamId, requesterId, newCaptainPlayerId, {
        requireRequesterConsent: true,
      }),
    );
  }

  /**
   * docs/adr/0013-account-erasure.md Decision 4 — applies the deferred
   * captain flip at execution time, "reusing transferCaptaincy's exact
   * transaction, just invoked by the sweep job instead of an HTTP call
   * from the captain." Deliberately NOT `transferCaptaincy` itself with a
   * bypass flag threaded through its public signature — that would widen a
   * security-relevant method's surface in a way a future, unrelated call
   * site could misuse without understanding why the bypass exists. This is
   * its own distinctly-named method instead, calling the same shared
   * `flipCaptaincy` core with `requireRequesterConsent: false`.
   *
   * Why skipping the requester's own consent check here is correct, not a
   * weakening: `transferCaptaincy`'s consent gate protects a *live,
   * HTTP-driven* action — "is the person acting right now actually
   * authorized to act." Here, `departingPlayerId` isn't acting; they
   * already authorized this exact handoff (by naming `successorPlayerId`
   * at their own erasure request, itself correctly requiring no consent
   * check — GDPR erasure cannot be conditioned on parental consent status)
   * and it has already been re-validated for validity twice since (at
   * confirm time, and again immediately before this call via
   * `resolveExecutionTimeSuccessor`/`isSuccessorStillValid`). Applying it
   * is a system action carrying out a previously-authorized decision, not
   * a new authorization decision — the departing player's own
   * (potentially still-pending, per ADR-0009) consent status has no
   * bearing on whether *that* is legitimate.
   *
   * A confirmed bug this method fixes: a self-created team's founding
   * captain (ADR-0009 explicitly allows this to exist with
   * `parentalConsentStatus: pending`) requesting their own erasure with a
   * chosen successor used to hang forever — every nightly sweep re-threw
   * `CaptainConsentRequiredException` from `transferCaptaincy`, retried
   * identically the next night, since nothing about that player's own
   * consent status ever changes on its own.
   *
   * Every other check `transferCaptaincy` performs (team match, self-
   * transfer, target-still-on-team, target-not-mid-erasure) is kept —
   * cheap, and a defensive backstop even though the erasure execution path
   * already independently guarantees most of them via
   * `resolveExecutionTimeSuccessor`'s fresh re-validation immediately
   * before this call.
   */
  async applyDeferredCaptainHandoff(
    teamId: string,
    departingPlayerId: string,
    successorPlayerId: string,
  ): Promise<CaptainTransferResult> {
    return this.dataSource.transaction((manager) =>
      this.flipCaptaincy(
        manager,
        teamId,
        departingPlayerId,
        successorPlayerId,
        { requireRequesterConsent: false },
      ),
    );
  }

  /**
   * The shared core behind transferCaptaincy/applyDeferredCaptainHandoff —
   * see transferCaptaincy's own comment for the locking/re-check reasoning
   * (fixed lock order, row-locked isCaptain re-check under that lock).
   * `requireRequesterConsent` is the one axis the two public callers
   * differ on — see applyDeferredCaptainHandoff's comment for why that
   * split is correct, not a weakening.
   */
  private async flipCaptaincy(
    manager: EntityManager,
    teamId: string,
    requesterId: string,
    newCaptainPlayerId: string,
    options: { requireRequesterConsent: boolean },
  ): Promise<CaptainTransferResult> {
    const requester = await this.findByIdForUpdate(manager, requesterId);
    if (requester.teamId !== teamId) {
      throw new TeamMismatchException();
    }
    if (!requester.isCaptain) {
      throw new NotTeamCaptainException();
    }
    // Same acting-captain consent gate as assertIsCaptainOfTeam (see its
    // comment) — only meaningful for a live, HTTP-driven transfer; see
    // applyDeferredCaptainHandoff's comment for why the erasure execution
    // path deliberately skips it.
    if (
      options.requireRequesterConsent &&
      requester.parentalConsentStatus !== ParentalConsentStatus.APPROVED
    ) {
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
    // docs/adr/0013-account-erasure.md Decision 4 (security-reviewer
    // finding, 2026-07-29) — a captain can no longer hand off onto a
    // teammate who is themselves already mid-erasure (requested or
    // grace_period), closing the gap where that handoff would need
    // immediate unwinding a moment later. Checked here, under the same
    // row lock already held on `target` above.
    if (await this.hasActiveErasureRequest(target.id, manager)) {
      throw new CaptainTransferTargetMidErasureException();
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
  }

  /**
   * Fas 4 (captain approval for new team joins,
   * docs/adr/0009-self-service-team-creation.md's 2026-07-27 addendum) —
   * every player on this team whose join is still awaiting the captain's
   * decision. Captain-only (assertIsCaptainOfTeam).
   */
  async listPendingJoins(
    teamId: string,
    requesterId: string,
  ): Promise<Player[]> {
    await this.assertIsCaptainOfTeam(requesterId, teamId);
    return this.playerRepository.find({
      where: { teamId, teamJoinStatus: TeamJoinStatus.PENDING },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Approve or reject a pending join — same captain-only gate as every
   * other captain action here. No row lock/transaction ceremony
   * (unlike transferCaptaincy): there's no unique-per-team invariant at
   * risk, just a single player's own status flipping once.
   */
  async decideTeamJoin(
    teamId: string,
    requesterId: string,
    targetPlayerId: string,
    decision: TeamJoinStatus.APPROVED | TeamJoinStatus.REJECTED,
  ): Promise<Player> {
    await this.assertIsCaptainOfTeam(requesterId, teamId);
    const target = await this.findByIdOrThrow(targetPlayerId);
    if (target.teamId !== teamId) {
      throw new TeamMismatchException();
    }
    if (target.teamJoinStatus !== TeamJoinStatus.PENDING) {
      throw new TeamJoinNotPendingException();
    }
    target.teamJoinStatus = decision;
    return this.playerRepository.save(target);
  }

  /**
   * ADR-0006 Decision 2 — "who's on my team, who's captain," open to any
   * teammate (team-membership check only, not captain-gated). Deliberately
   * narrower than listByTeam's captain-only consumers (roster): only
   * playerId/screenName/avatarId/isCaptain, per the contract's "nothing
   * else" — no consentStatus/lastTrainedDate here.
   *
   * `options.approvedOnly` (default `false`, today's unfiltered behavior)
   * — an opt-in `teamJoinStatus === APPROVED` filter, NOT a global default.
   * This method backs at least three independent pickers with three
   * independent questions about a still-`PENDING` (not yet captain-
   * approved) joiner: the video-clip "tag a teammate to challenge them"
   * picker (`V5CaptionChallenge.tsx`, ADR-0021), the ADR-0006 captain-
   * transfer target picker, and the ADR-0013 GDPR account-erasure
   * successor picker (`ErasureSuccessorScreen.tsx`) — whose own backend
   * validity check, `isSuccessorStillValid`
   * (`account-erasure/successor-validation.util.ts`), has never required
   * `teamJoinStatus === APPROVED` and isn't being changed by ADR-0021 at
   * all. Filtering this method's *default* output would have silently
   * narrowed all three at once for a decision that was only ever reasoned
   * about for the first (code-critic finding, 2026-08-06 pre-merge pass —
   * an earlier version of this method did exactly that, caught before
   * merge). Only a caller that explicitly opts in via `approvedOnly: true`
   * gets the narrower list; every other caller (including the two above)
   * keeps exactly its pre-ADR-0021 behavior. `GET .../teammates`
   * (`weekly-goal.controller.ts`) exposes this as an optional
   * `?approvedOnly=true` query param — see `docs/api/phase2-contract.md`
   * endpoint 10's 2026-08-06 revision for the read-side contract.
   */
  async listTeammates(
    teamId: string,
    requesterId: string,
    options: { approvedOnly?: boolean } = {},
  ): Promise<TeammateEntry[]> {
    await this.assertTeamMembership(requesterId, teamId);
    const players = await this.listByTeam(teamId);
    return players
      .filter(
        (player) =>
          !options.approvedOnly ||
          player.teamJoinStatus === TeamJoinStatus.APPROVED,
      )
      .map((player) => ({
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
   * docs/adr/0012-profile-page-and-contact-email-change.md's addendum —
   * the contact-change cancel flow's "kill whatever session did this."
   * Same row-locked read-then-write shape as setSessionReissueCode
   * (caller reads the current value via findByIdForUpdate first), but
   * bumps token_version alone — no code/expiry, since this is a pure
   * invalidation, not a recovery mechanism in itself. The old address
   * holder saying "this wasn't me" is exactly the moment forcing a fresh
   * login is warranted.
   */
  async bumpTokenVersion(
    manager: EntityManager,
    playerId: string,
    newTokenVersion: number,
  ): Promise<void> {
    await manager
      .getRepository(Player)
      .update({ id: playerId }, { tokenVersion: newTokenVersion });
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
   * Team-scoped, case-insensitive lookup for the self-service
   * session-reissue-request endpoint (docs/adr/0004-coach-auth-and-
   * session-reissue.md's 2026-07-27 addendum) — a player identifying
   * themselves by team invite code + their own screen name shouldn't need
   * to remember its exact capitalization. Returns `null` for zero *or
   * more than one* match: the `(team_id, screen_name)` unique index is
   * case-*sensitive*, so two players named e.g. `Foo`/`foo` on one team is
   * possible today, and silently picking one via `LIMIT 1` would risk
   * reissuing the wrong player's session — refusing to guess is the safe
   * default here, especially since the caller (an unauthenticated,
   * generic-response endpoint) can't be told to disambiguate anyway.
   *
   * Known, accepted limitation (security-reviewer, 2026-07-27, not fixed
   * here — see the ADR addendum): a case-variant duplicate on a team
   * silently and permanently disables self-service reissue for the
   * affected player(s), with no visible error (the endpoint's response is
   * always generic). Not fixed by enforcing case-insensitive uniqueness at
   * onboarding, since that's a separate, broader behavior change outside
   * this redesign's scope. The captain-triggered path (`triggerReissue`)
   * is unaffected — it resolves the target by player ID from the roster,
   * never by screen-name lookup — so this is a real but narrow gap with an
   * existing fallback, not a dead end.
   */
  async findUniqueByTeamAndScreenName(
    teamId: string,
    screenName: string,
  ): Promise<Player | null> {
    const matches = await this.playerRepository
      .createQueryBuilder('player')
      .where('player.team_id = :teamId', { teamId })
      .andWhere('LOWER(player.screen_name) = LOWER(:screenName)', {
        screenName,
      })
      .getMany();
    return matches.length === 1 ? matches[0] : null;
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

  /**
   * docs/adr/0013-account-erasure.md Decision 4 — does this player
   * currently hold an active (requested/grace_period)
   * `AccountErasureRequest`? Used by transferCaptaincy's new rejection
   * above, and by findAutoFallbackCaptainCandidate below.
   */
  async hasActiveErasureRequest(
    playerId: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    const repository = manager
      ? manager.getRepository(AccountErasureRequest)
      : this.accountErasureRequestRepository;
    const count = await repository.count({
      where: { playerId, status: In(ACTIVE_ERASURE_STATUSES) },
    });
    return count > 0;
  }

  /**
   * docs/adr/0013-account-erasure.md Decision 4/5 — the auto-fallback
   * captain candidate: the longest-tenured (earliest-joined) teammate not
   * in `excludePlayerIds` (the departing player, plus — when called from
   * a same-team sweep batch — every other player erasing in that same
   * run) AND not themselves currently mid-erasure (security-reviewer
   * finding, 2026-07-29: without this second exclusion, a same-sweep-run
   * auto-pick could crown someone captain moments before their own row is
   * deleted later in the identical run, since neither this sweep nor
   * ClipRetentionService guarantees any row-processing order). Returns
   * `null` if no eligible candidate remains (the "every teammate is also
   * erasing this run" case — handled by AccountErasureSweepService's
   * batching routing that scenario through the team-cascade path instead,
   * never through this method).
   */
  async findAutoFallbackCaptainCandidate(
    teamId: string,
    excludePlayerIds: string[],
    manager?: EntityManager,
  ): Promise<Player | null> {
    const playerRepository = manager
      ? manager.getRepository(Player)
      : this.playerRepository;
    const erasureRepository = manager
      ? manager.getRepository(AccountErasureRequest)
      : this.accountErasureRequestRepository;

    const qb = playerRepository
      .createQueryBuilder('player')
      .where('player.team_id = :teamId', { teamId })
      .orderBy('player.created_at', 'ASC');
    if (excludePlayerIds.length > 0) {
      qb.andWhere('player.id NOT IN (:...excludePlayerIds)', {
        excludePlayerIds,
      });
    }
    const candidates = await qb.getMany();
    if (candidates.length === 0) return null;

    const activeErasureRows = await erasureRepository.find({
      where: {
        playerId: In(candidates.map((candidate) => candidate.id)),
        status: In(ACTIVE_ERASURE_STATUSES),
      },
    });
    const excludedByErasure = new Set(
      activeErasureRows.map((row) => row.playerId),
    );
    return candidates.find((c) => !excludedByErasure.has(c.id)) ?? null;
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
