import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThanOrEqual, Repository } from 'typeorm';
import {
  ErasureAlreadyActiveException,
  ErasureBlockedPendingContactChangeException,
  ErasureRateLimitedException,
  ErasureRequestNotActiveException,
  ErasureSuccessorInvalidException,
  ErasureSuccessorNotAllowedException,
  ErasureSuccessorRequiredException,
} from '../common/errors/exceptions';
import { decryptPii, encryptPii } from '../common/crypto/pii-encryption.util';
import { generateHumanCode } from '../common/crypto/human-code.util';
import { isPostgresUniqueViolation } from '../common/errors/postgres-error.util';
import { MailService } from '../mail/mail.service';
import { buildErasureCancelEmail } from '../mail/templates/erasure-cancel-email.template';
import { buildErasureConfirmEmail } from '../mail/templates/erasure-confirm-email.template';
import { ObjectStorageService } from '../video-clips/object-storage.service';
import { VideoClip } from '../video-clips/entities/video-clip.entity';
import { Challenge } from '../challenges/entities/challenge.entity';
import { TeamChatMessage } from '../team-chat/entities/team-chat-message.entity';
import { Team } from '../teams/entities/team.entity';
import { Player } from '../players/entities/player.entity';
import { PlayerPrivateInfoService } from '../player-private-info/player-private-info.service';
import { PlayersService } from '../players/players.service';
import { RedisService } from '../redis/redis.service';
import {
  ERASED_CHAT_MESSAGE_PLACEHOLDER,
  ERASURE_CONFIRM_CODE_TTL_MS,
  ERASURE_GRACE_PERIOD_MS,
} from './account-erasure.constants';
import {
  AccountErasureRequest,
  AccountErasureStatus,
} from './entities/account-erasure-request.entity';
import { isSuccessorStillValid } from './successor-validation.util';

const ACTIVE_STATUSES = [
  AccountErasureStatus.REQUESTED,
  AccountErasureStatus.GRACE_PERIOD,
];

const DEFAULT_APP_PUBLIC_URL = 'http://localhost:3000';

export interface RequestErasureResponse {
  requested: true;
  expiresAt: string;
}

export interface ConfirmErasureResponse {
  confirmed: true;
  scheduledFor: string;
}

export interface ErasureStatusResponse {
  status: 'none' | 'requested' | 'grace_period';
  scheduledFor?: string;
  successorScreenName?: string;
}

function isConfirmCodeLive(row: AccountErasureRequest): boolean {
  return (
    row.confirmCodeExpiresAt !== null &&
    row.confirmCodeExpiresAt.getTime() > Date.now()
  );
}

function dateLabel(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// docs/adr/0013-account-erasure.md — self-service GDPR account erasure.
// Every authenticated method operates on the caller's own playerId
// (`/players/me/...` routes, no `:playerId` param, no IDOR surface), same
// posture as ProfileService. The three unauthenticated methods
// (previewConfirm/confirmErasure, previewCancel/cancelByCode) exist by
// necessity — the whole point of Decision 2's fix is that a bare in-app
// tap (which could come from a momentarily-borrowed/compromised session)
// must not be enough on its own to complete this irreversible action.
//
// Also owns the two execution-time entry points
// (executeSingleErasure/executeTeamCascade) that AccountErasureSweepService
// calls into — kept on this service, not the sweep service, so "the
// TeamChatMessage content-anonymizing UPDATE lives only inside
// AccountErasureService's own execution transaction" (Decision 6's
// explicit requirement) is true by construction: that UPDATE is written
// nowhere else in this codebase, never as a reusable repository method.
@Injectable()
export class AccountErasureService {
  private readonly logger = new Logger(AccountErasureService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(AccountErasureRequest)
    private readonly accountErasureRequestRepository: Repository<AccountErasureRequest>,
    @InjectRepository(VideoClip)
    private readonly videoClipRepository: Repository<VideoClip>,
    private readonly playersService: PlayersService,
    private readonly playerPrivateInfoService: PlayerPrivateInfoService,
    private readonly objectStorageService: ObjectStorageService,
    private readonly redisService: RedisService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  private get encryptionKey(): string {
    return this.configService.getOrThrow<string>('PII_ENCRYPTION_KEY');
  }

  private appPublicUrl(): string {
    return (
      this.configService.get<string>('APP_PUBLIC_URL') ?? DEFAULT_APP_PUBLIC_URL
    );
  }

  // --- Request -----------------------------------------------------------

  /**
   * docs/adr/0013-account-erasure.md Decision 3. Order: fetch the caller's
   * own row -> the contact-change-race gate (Decision 2, checked BEFORE
   * anything else so a blocked caller doesn't burn rate-limit budget on a
   * request that's going to fail anyway) -> successor validation (state-
   * dependent: required iff captain with >=1 teammate, forbidden otherwise,
   * Decision 4) -> rate limiting (burst cooldown, then daily cap) -> the
   * one-time parentContact resolution (Decision 2 step 2) -> persist ->
   * best-effort email.
   */
  async requestErasure(
    playerId: string,
    successorPlayerId?: string,
  ): Promise<RequestErasureResponse> {
    const player = await this.playersService.findByIdOrThrow(playerId);

    if (await this.playerPrivateInfoService.hasPendingContactChange(playerId)) {
      throw new ErasureBlockedPendingContactChangeException();
    }

    const teammates = await this.playersService.listByTeam(player.teamId);
    const hasTeammates = teammates.some((teammate) => teammate.id !== playerId);
    const successorRequired = player.isCaptain && hasTeammates;

    if (successorRequired && !successorPlayerId) {
      throw new ErasureSuccessorRequiredException();
    }
    if (!successorRequired && successorPlayerId) {
      throw new ErasureSuccessorNotAllowedException();
    }

    if (successorPlayerId) {
      const valid = await isSuccessorStillValid(
        this.dataSource.manager,
        player.teamId,
        playerId,
        successorPlayerId,
      );
      if (!valid) {
        throw new ErasureSuccessorInvalidException();
      }
    }

    const burstClaimed =
      await this.redisService.tryClaimErasureRequestCooldown(playerId);
    if (!burstClaimed) {
      throw new ErasureRateLimitedException();
    }
    const dailyClaimed =
      await this.redisService.tryClaimErasureRequestDailyCap(playerId);
    if (!dailyClaimed) {
      throw new ErasureRateLimitedException();
    }

    // Decision 2 step 2 — resolved exactly once, for the rest of this
    // row's lifecycle (including the confirm-time cancel-link email).
    const parentContact =
      await this.playerPrivateInfoService.getParentContact(playerId);
    const { code, expiresAt } = generateHumanCode(ERASURE_CONFIRM_CODE_TTL_MS);

    const repository = this.accountErasureRequestRepository;
    try {
      await repository.save(
        repository.create({
          playerId,
          teamId: player.teamId,
          successorPlayerId: successorPlayerId ?? null,
          status: AccountErasureStatus.REQUESTED,
          confirmCode: code,
          confirmCodeExpiresAt: expiresAt,
          recipientContactSnapshot: parentContact
            ? encryptPii(parentContact, this.encryptionKey)
            : null,
        }),
      );
    } catch (error) {
      if (
        isPostgresUniqueViolation(
          error,
          'idx_account_erasure_request_one_active_per_player',
        )
      ) {
        throw new ErasureAlreadyActiveException();
      }
      throw error;
    }

    await this.sendConfirmEmailBestEffort(
      player.screenName,
      parentContact,
      code,
    );

    return { requested: true, expiresAt: expiresAt.toISOString() };
  }

  // --- Confirm (unauthenticated — mailed link) ----------------------------

  /** GET-side preview — no side effects, see ProfileService's identical
   * comment for why. */
  async previewConfirm(code: string): Promise<{ screenName: string } | null> {
    const row = await this.accountErasureRequestRepository.findOne({
      where: { confirmCode: code },
    });
    if (
      !row ||
      row.status !== AccountErasureStatus.REQUESTED ||
      !isConfirmCodeLive(row)
    ) {
      return null;
    }
    const player = await this.playersService.findById(row.playerId);
    if (!player) return null;
    return { screenName: player.screenName };
  }

  /**
   * The POST side — the actual action. Returns `null` (not a thrown
   * exception) for "no such code / expired / already confirmed or
   * cancelled" — same friendly-no-op idiom as
   * ConsentService.approve/cancelByCode below, since this is an
   * unauthenticated, HTML-rendering link route (AccountErasureController
   * renders the invalid-link page for a `null`, not a JSON error).
   *
   * Re-validates the named successor (still on the team, not itself
   * mid-erasure) if one was supplied at request time; if it's no longer
   * valid, it's simply cleared to null here rather than failing the whole
   * confirm — Decision 4's live execution-time re-check + auto-fallback is
   * what handles "no still-valid named successor" generally, so this
   * doesn't need its own separate failure mode.
   */
  async confirmErasure(code: string): Promise<ConfirmErasureResponse | null> {
    const result = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AccountErasureRequest);
      const row = await repository
        .createQueryBuilder('r')
        .setLock('pessimistic_write')
        .where('r.confirm_code = :code', { code })
        .getOne();
      if (
        !row ||
        row.status !== AccountErasureStatus.REQUESTED ||
        !isConfirmCodeLive(row)
      ) {
        return null;
      }

      let successorPlayerId = row.successorPlayerId;
      if (successorPlayerId) {
        const valid = await isSuccessorStillValid(
          manager,
          row.teamId,
          row.playerId,
          successorPlayerId,
        );
        if (!valid) successorPlayerId = null;
      }

      const { code: cancelCode, expiresAt: scheduledFor } = generateHumanCode(
        ERASURE_GRACE_PERIOD_MS,
      );
      row.status = AccountErasureStatus.GRACE_PERIOD;
      row.confirmCode = null;
      row.confirmCodeExpiresAt = null;
      row.confirmedAt = new Date();
      row.scheduledFor = scheduledFor;
      row.cancelCode = cancelCode;
      row.successorPlayerId = successorPlayerId;
      await repository.save(row);

      return {
        playerId: row.playerId,
        recipientContactSnapshot: row.recipientContactSnapshot,
        cancelCode,
        scheduledFor,
      };
    });

    if (!result) return null;

    await this.sendCancelEmailBestEffort(
      result.playerId,
      result.recipientContactSnapshot,
      result.cancelCode,
      result.scheduledFor,
    );

    return { confirmed: true, scheduledFor: result.scheduledFor.toISOString() };
  }

  // --- Cancel --------------------------------------------------------------

  /**
   * The authenticated, primary cancel path (Decision 7) — the account
   * stays fully live during the whole grace period, so an in-app button is
   * the obvious low-friction route. No token_version bump on either cancel
   * path (Decision 7) — unlike ADR-0012's cancel, the confirm and cancel
   * emails here go to the SAME snapshotted address in the SAME flow, with
   * no attacker-controlled alternate destination for a bump to protect
   * against.
   */
  async cancel(playerId: string): Promise<{ cancelled: true }> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AccountErasureRequest);
      const row = await repository
        .createQueryBuilder('r')
        .setLock('pessimistic_write')
        .where('r.player_id = :playerId', { playerId })
        .andWhere('r.status IN (:...statuses)', { statuses: ACTIVE_STATUSES })
        .getOne();
      if (!row) {
        throw new ErasureRequestNotActiveException();
      }
      row.status = AccountErasureStatus.CANCELLED;
      row.cancelledAt = new Date();
      row.cancelCode = null;
      row.confirmCode = null;
      row.confirmCodeExpiresAt = null;
      await repository.save(row);
    });
    return { cancelled: true };
  }

  /** GET-side preview for the mailed cancel link — no side effects. */
  async previewCancel(code: string): Promise<{ screenName: string } | null> {
    const row = await this.accountErasureRequestRepository.findOne({
      where: { cancelCode: code },
    });
    if (!row || row.status !== AccountErasureStatus.GRACE_PERIOD) return null;
    const player = await this.playersService.findById(row.playerId);
    if (!player) return null;
    return { screenName: player.screenName };
  }

  /**
   * The mailed cancel link's POST action — a backup for "I don't have my
   * session/this is a new phone," not the primary route (see cancel()
   * above). Returns null (not a thrown error) for "no such code / already
   * used / already executed" — same friendly-no-op idiom as
   * ConsentService.approve/ProfileService.cancelContactChange.
   */
  async cancelByCode(code: string): Promise<{ screenName: string } | null> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AccountErasureRequest);
      const row = await repository
        .createQueryBuilder('r')
        .setLock('pessimistic_write')
        .where('r.cancel_code = :code', { code })
        .getOne();
      if (!row || row.status !== AccountErasureStatus.GRACE_PERIOD) {
        return null;
      }
      row.status = AccountErasureStatus.CANCELLED;
      row.cancelledAt = new Date();
      row.cancelCode = null;
      await repository.save(row);

      const player = await manager
        .getRepository(Player)
        .findOne({ where: { id: row.playerId } });
      return player ? { screenName: player.screenName } : null;
    });
  }

  // --- Status ----------------------------------------------------------------

  /** Backs the Profile-screen banner (Decision 3). */
  async getStatus(playerId: string): Promise<ErasureStatusResponse> {
    const row = await this.accountErasureRequestRepository
      .createQueryBuilder('r')
      .where('r.player_id = :playerId', { playerId })
      .andWhere('r.status IN (:...statuses)', { statuses: ACTIVE_STATUSES })
      .getOne();
    if (!row) return { status: 'none' };
    if (row.status === AccountErasureStatus.GRACE_PERIOD) {
      // successorPlayerId can be null here even for a captain's own
      // request — confirm-time re-validation clears an invalid/stale
      // choice back to null rather than failing the confirm (see
      // Decision 4's execution-time auto-fallback, which is what
      // actually handles "no still-valid successor"). Omitting the name
      // in that case is correct, not a bug: the UI copy this backs
      // ("{successor} tar över...") simply doesn't apply until execution
      // decides for real.
      const successor = row.successorPlayerId
        ? await this.playersService.findById(row.successorPlayerId)
        : null;
      return {
        status: 'grace_period',
        scheduledFor: row.scheduledFor?.toISOString(),
        successorScreenName: successor?.screenName,
      };
    }
    return { status: 'requested' };
  }

  // --- Execution (called by AccountErasureSweepService) ---------------------

  /** Due rows for the scheduled sweep — Decision 8. */
  async findDueRows(): Promise<AccountErasureRequest[]> {
    return this.accountErasureRequestRepository.find({
      where: {
        status: AccountErasureStatus.GRACE_PERIOD,
        scheduledFor: LessThanOrEqual(new Date()),
      },
    });
  }

  /**
   * Decision 5's last-player-deletes-team path, batched for the WHOLE team
   * at once, never per-row. MinIO objects are purged before the team
   * delete (outside the transaction, same idempotent delete-if-exists
   * posture as ClipRetentionService) — if any purge fails, this throws and
   * the whole team's batch is left for the next sweep run untouched (no
   * partial DB state), same as executeSingleErasure's failure posture.
   */
  async executeTeamCascade(
    teamId: string,
    batchRows: AccountErasureRequest[],
  ): Promise<void> {
    const clips = await this.videoClipRepository.find({ where: { teamId } });
    for (const clip of clips) {
      await this.objectStorageService.deleteObjectIfExists(clip.storageKey);
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Team).delete({ id: teamId });
      await manager
        .getRepository(AccountErasureRequest)
        .update(
          { id: In(batchRows.map((row) => row.id)) },
          { status: AccountErasureStatus.EXECUTED, executedAt: new Date() },
        );
    });

    for (const row of batchRows) {
      await this.redisService.removeFromLeaderboard(teamId, row.playerId);
    }
  }

  /**
   * Decision 6's per-entity rules, for the non-last-player case — one
   * player, the team continues. `excludeFromFallback` is this sweep run's
   * whole same-team batch (Decision 5): a captain auto-fallback must never
   * crown someone else who is also being deleted in this identical run.
   *
   * The deferred captain flip (Decision 4) is applied via
   * PlayersService.applyDeferredCaptainHandoff — its OWN transaction, as a
   * pre-step BEFORE the main execution transaction below — "reusing
   * transferCaptaincy's exact transaction, just invoked by the sweep job
   * instead of an HTTP call from the captain" (Decision 4), not folded into
   * this method's own transaction. Deliberately NOT `transferCaptaincy`
   * itself: that method requires the *requester's* own consent to be
   * approved, which is the right rule for a live HTTP-driven action but
   * wrong here — `row.playerId` (the departing player) isn't performing a
   * live action, they already authorized this exact handoff when they
   * named `successorId` at their own erasure request (which correctly
   * never checked their consent status either — see
   * applyDeferredCaptainHandoff's own comment for the full reasoning,
   * including the confirmed bug this fixes: a self-created team's founding
   * captain with still-`pending` consent, per ADR-0009, could otherwise
   * never actually complete their own erasure).
   *
   * This is safe to retry: the live `isCaptain` check immediately before
   * is what makes a retry idempotent — if a prior run already flipped
   * captaincy but then failed before the main transaction committed, this
   * player's `isCaptain` is already false on the next attempt, so
   * applyDeferredCaptainHandoff is simply not called again.
   */
  async executeSingleErasure(
    row: AccountErasureRequest,
    excludeFromFallback: string[],
  ): Promise<void> {
    const clips = await this.videoClipRepository.find({
      where: { uploaderPlayerId: row.playerId },
    });
    for (const clip of clips) {
      await this.objectStorageService.deleteObjectIfExists(clip.storageKey);
    }

    const currentPlayer = await this.playersService.findByIdOrThrow(
      row.playerId,
    );
    if (currentPlayer.isCaptain) {
      const successorId = await this.resolveExecutionTimeSuccessor(
        row,
        excludeFromFallback,
      );
      if (successorId) {
        await this.playersService.applyDeferredCaptainHandoff(
          row.teamId,
          row.playerId,
          successorId,
        );
      }
    }

    await this.dataSource.transaction(async (manager) => {
      // Decision 6 — anonymize, don't hard-delete: preserves the remaining
      // team's flat chat feed continuity. This UPDATE is deliberately
      // written ONLY here, never as a reusable repository method anywhere
      // else in this codebase (Decision 6's explicit note) — a narrow,
      // documented exception to ADR-0007's "send-once, never mutated"
      // invariant, scoped to this execution path alone.
      await manager
        .getRepository(TeamChatMessage)
        .update(
          { senderPlayerId: row.playerId },
          { senderPlayerId: null, content: ERASED_CHAT_MESSAGE_PLACEHOLDER },
        );

      // Decision 6 — "detach the identity, keep the row," the same pattern
      // VideoClip.taggedPlayerId already established: this is shared team
      // history (other teammates already earned bonus points from it), not
      // solely this player's own content.
      await manager
        .getRepository(Challenge)
        .update(
          { createdByPlayerId: row.playerId },
          { createdByPlayerId: null },
        );

      await manager
        .getRepository(VideoClip)
        .delete({ uploaderPlayerId: row.playerId });

      await manager.getRepository(Player).delete({ id: row.playerId });

      await manager
        .getRepository(AccountErasureRequest)
        .update(
          { id: row.id },
          { status: AccountErasureStatus.EXECUTED, executedAt: new Date() },
        );
    });

    await this.redisService.removeFromLeaderboard(row.teamId, row.playerId);
  }

  /**
   * Decision 4's live execution-time captain check — resolves who (if
   * anyone) should become captain in currentPlayer's place. Tries the
   * named successor first (re-validated fresh, right now); falls back to
   * PlayersService.findAutoFallbackCaptainCandidate (longest-tenured
   * remaining teammate, itself already excluding anyone with an active
   * erasure request) otherwise. Never special-cased to "the batch"
   * scenario alone — this runs identically whether the row got here via
   * this run's team batch or a lone player independently becoming captain
   * after requesting erasure with no successor.
   */
  private async resolveExecutionTimeSuccessor(
    row: AccountErasureRequest,
    excludeFromFallback: string[],
  ): Promise<string | null> {
    if (row.successorPlayerId) {
      const valid = await isSuccessorStillValid(
        this.dataSource.manager,
        row.teamId,
        row.playerId,
        row.successorPlayerId,
      );
      if (valid) return row.successorPlayerId;
    }
    const fallback = await this.playersService.findAutoFallbackCaptainCandidate(
      row.teamId,
      [...excludeFromFallback, row.playerId],
    );
    return fallback?.id ?? null;
  }

  // --- Email (best-effort, never blocks/throws) -----------------------------

  private async sendConfirmEmailBestEffort(
    screenName: string,
    parentContact: string | null,
    code: string,
  ): Promise<void> {
    if (!parentContact) {
      this.logger.warn(
        'No parent contact on file to send the erasure confirm email to — the request still exists, but nobody was notified.',
      );
      return;
    }
    const confirmUrl = `${this.appPublicUrl()}/api/v1/players/erasure-confirm/${code}`;
    const email = buildErasureConfirmEmail({
      screenName,
      confirmUrl,
      expiresInHours: Math.round(ERASURE_CONFIRM_CODE_TTL_MS / 3_600_000),
    });
    try {
      await this.mailService.sendMail({
        to: parentContact,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to send erasure confirm email: ${message}`);
    }
  }

  private async sendCancelEmailBestEffort(
    playerId: string,
    recipientContactSnapshot: string | null,
    cancelCode: string,
    scheduledFor: Date,
  ): Promise<void> {
    if (!recipientContactSnapshot) {
      this.logger.warn(
        'No recipient snapshot on file to send the erasure cancel email to — the grace period still applies, but nobody was notified.',
      );
      return;
    }
    const player = await this.playersService.findById(playerId);
    if (!player) return;
    const recipient = decryptPii(recipientContactSnapshot, this.encryptionKey);
    const cancelUrl = `${this.appPublicUrl()}/api/v1/players/erasure-cancel/${cancelCode}`;
    const email = buildErasureCancelEmail({
      screenName: player.screenName,
      cancelUrl,
      scheduledForDateLabel: dateLabel(scheduledFor),
    });
    try {
      await this.mailService.sendMail({
        to: recipient,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to send erasure cancel email: ${message}`);
    }
  }
}
