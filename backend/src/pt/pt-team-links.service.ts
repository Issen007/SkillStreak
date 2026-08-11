import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  PtInviteCodeInvalidException,
  PtTeamLinkAlreadyActiveException,
  PtTeamLinkNotFoundException,
} from '../common/errors/exceptions';
import { generateHumanCode } from '../common/crypto/human-code.util';
import { isPostgresUniqueViolation } from '../common/errors/postgres-error.util';
import { PlayersService } from '../players/players.service';
import { RedisService } from '../redis/redis.service';
import { StaffAccount } from '../staff-auth/entities/staff-account.entity';
import {
  PtPlayerConsent,
  PtPlayerConsentRevokedReason,
  PtPlayerConsentStatus,
} from './entities/pt-player-consent.entity';
import { PtTeamLink, PtTeamLinkStatus } from './entities/pt-team-link.entity';

const ONE_ACTIVE_LINK_PER_TEAM_PT_CONSTRAINT =
  'idx_pt_team_link_one_active_per_team_pt';

export interface PtTeamLinkInviteResult {
  code: string;
  expiresAt: string;
}

export interface PtTeamLinkRow {
  id: string;
  teamId: string;
  ptStaffAccountId: string;
  ptEmail: string;
  ptDisplayName: string | null;
  status: PtTeamLinkStatus;
  createdAt: string;
  revokedAt: string | null;
}

function toRow(
  link: PtTeamLink,
  staffAccount: StaffAccount | null,
): PtTeamLinkRow {
  return {
    id: link.id,
    teamId: link.teamId,
    ptStaffAccountId: link.ptStaffAccountId,
    ptEmail: staffAccount?.email ?? '',
    ptDisplayName: staffAccount?.displayName ?? null,
    status: link.status,
    createdAt: link.createdAt.toISOString(),
    revokedAt: link.revokedAt ? link.revokedAt.toISOString() : null,
  };
}

// docs/adr/0023-pt-role-and-staff-sso-rbac.md Decision A2 (the team-level
// "step 1" link) and Decision A4 point 3 (the team's own revocation
// lever). Owns PtTeamLink CRUD only — the team-aggregate/per-player DATA
// reads live on PtDataService, and the per-player CONSENT chain lives on
// PtConsentService, per this ADR's own "keep concerns separate" framing
// (mirrors CLAUDE.md's individual-streak-vs-team-pool separation instinct,
// applied here to link-vs-consent-vs-data).
@Injectable()
export class PtTeamLinksService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly playersService: PlayersService,
    private readonly redisService: RedisService,
    @InjectRepository(PtTeamLink)
    private readonly ptTeamLinkRepository: Repository<PtTeamLink>,
    @InjectRepository(StaffAccount)
    private readonly staffAccountRepository: Repository<StaffAccount>,
  ) {}

  /**
   * Captain-only (docs/adr/0023 Decision A2 "step 1") — generates a
   * short, human-shareable, 24h-TTL, single-use code, stored in Redis (not
   * a Postgres row — see the PtTeamLink entity's own comment), structurally
   * identical in shape to Team.invite_code/the session-reissue code this
   * ADR names as its direct precedent. On its own, this grants NOTHING —
   * only PtTeamLinksService.redeemInvite (a `pt`-role StaffAccount's own
   * action) actually creates the PtTeamLink row.
   */
  async generateInvite(
    requesterId: string,
    teamId: string,
  ): Promise<PtTeamLinkInviteResult> {
    await this.playersService.assertIsCaptainOfTeam(requesterId, teamId);

    const { code, expiresAt } = generateHumanCode(24 * 60 * 60 * 1000);
    const claimed = await this.redisService.storePtTeamLinkInviteCode(code, {
      teamId,
      invitedByPlayerId: requesterId,
    });
    if (!claimed) {
      // Astronomically unlikely (see RedisService's own comment) — no
      // retry loop, same posture as every other generateHumanCode call
      // site in this app.
      throw new PtInviteCodeInvalidException();
    }

    return { code, expiresAt: expiresAt.toISOString() };
  }

  /**
   * The `pt`-role StaffAccount's own redemption of a captain-generated
   * code — the action that actually creates the PtTeamLink row. Atomic
   * get-and-delete (RedisService.redeemPtTeamLinkInviteCode) makes this
   * single-use even under a concurrent double-submit of the *same* code.
   *
   * Known narrow race, deliberately not engineered around (code-critic
   * finding, judged not worth the complexity of a peek-before-consume
   * Redis call): the code's target team is only known *after* it's been
   * burned, so if the same PT redeems two different still-valid codes for
   * the same team in quick succession, the second GETDEL still succeeds
   * (burning that code) before this insert discovers
   * ONE_ACTIVE_LINK_PER_TEAM_PT_CONSTRAINT already has a row — the second
   * code is wasted (throws PtTeamLinkAlreadyActiveException, but with no
   * way to recover that specific code). Not a security issue, just a
   * UX/robustness gap: the captain would need to mint a fresh code.
   */
  async redeemInvite(
    ptStaffAccountId: string,
    code: string,
  ): Promise<PtTeamLinkRow> {
    const payload = await this.redisService.redeemPtTeamLinkInviteCode(code);
    if (!payload) {
      throw new PtInviteCodeInvalidException();
    }

    let saved: PtTeamLink;
    try {
      saved = await this.ptTeamLinkRepository.save(
        this.ptTeamLinkRepository.create({
          teamId: payload.teamId,
          ptStaffAccountId,
          invitedByPlayerId: payload.invitedByPlayerId,
          status: PtTeamLinkStatus.ACTIVE,
        }),
      );
    } catch (error) {
      if (
        isPostgresUniqueViolation(error, ONE_ACTIVE_LINK_PER_TEAM_PT_CONSTRAINT)
      ) {
        throw new PtTeamLinkAlreadyActiveException();
      }
      throw error;
    }

    const staffAccount = await this.staffAccountRepository.findOne({
      where: { id: ptStaffAccountId },
    });
    return toRow(saved, staffAccount);
  }

  /** Captain-facing list of every PT link (active and historical) on their
   * own team — needed so a captain has real ids to act on for the revoke
   * endpoint below. */
  /**
   * "Has a team ever invited this trainer, and is that still true?"
   *
   * Added for ADR-0029 Decision 4, which gates the drill library on it.
   * The point is that a trainer becomes a reader by the same act that
   * already makes them useful — a team invited them — so ADR-0023
   * Decision B1's property survives verbatim: a freshly signed-up account
   * is indistinguishable in capability from someone who never signed up.
   *
   * Deliberately answers only yes/no and names no team. The caller is
   * deciding whether to show adult-authored text, not what to show about
   * anybody's team.
   *
   * **If ADR-0023 Part C ships, this moves inside its `findActiveLink` /
   * `listActiveLinks` resolver** rather than remaining a fourth
   * independent answer to "does this PT hold an active link" — which is
   * exactly the duplication C6 exists to collapse. Recorded here so the
   * move is obvious to whoever builds C6.
   */
  async hasAnyActiveLink(ptStaffAccountId: string): Promise<boolean> {
    const count = await this.ptTeamLinkRepository.count({
      where: { ptStaffAccountId, status: PtTeamLinkStatus.ACTIVE },
    });
    return count > 0;
  }

  async listForTeam(
    requesterId: string,
    teamId: string,
  ): Promise<PtTeamLinkRow[]> {
    await this.playersService.assertIsCaptainOfTeam(requesterId, teamId);

    const links = await this.ptTeamLinkRepository.find({
      where: { teamId },
      order: { createdAt: 'DESC' },
    });

    return Promise.all(
      links.map(async (link) => {
        const staffAccount = await this.staffAccountRepository.findOne({
          where: { id: link.ptStaffAccountId },
        });
        return toRow(link, staffAccount);
      }),
    );
  }

  /**
   * docs/adr/0023 Decision A4 point 3 — the team's own circuit breaker,
   * independent of any single family's own action. Cascades, in one
   * transaction, to `status = 'revoked'` on every currently-
   * `pending_review`/`approved` PtPlayerConsent row rooted under this
   * link, per revoked_reason = 'team_link_revoked'.
   */
  async revoke(
    requesterId: string,
    teamId: string,
    linkId: string,
  ): Promise<{ revoked: true; cascadedConsentCount: number }> {
    await this.playersService.assertIsCaptainOfTeam(requesterId, teamId);

    return this.dataSource.transaction(async (manager) => {
      const linkRepository = manager.getRepository(PtTeamLink);
      const link = await linkRepository
        .createQueryBuilder('link')
        .setLock('pessimistic_write')
        .where('link.id = :linkId', { linkId })
        .andWhere('link.team_id = :teamId', { teamId })
        .andWhere('link.status = :status', {
          status: PtTeamLinkStatus.ACTIVE,
        })
        .getOne();
      if (!link) {
        throw new PtTeamLinkNotFoundException();
      }

      link.status = PtTeamLinkStatus.REVOKED;
      link.revokedAt = new Date();
      await linkRepository.save(link);

      const consentRepository = manager.getRepository(PtPlayerConsent);
      const cascaded = await consentRepository
        .createQueryBuilder()
        .update(PtPlayerConsent)
        .set({
          status: PtPlayerConsentStatus.REVOKED,
          revokedAt: new Date(),
          revokedReason: PtPlayerConsentRevokedReason.TEAM_LINK_REVOKED,
        })
        .where('pt_team_link_id = :linkId', { linkId })
        .andWhere('status IN (:...statuses)', {
          statuses: [
            PtPlayerConsentStatus.PENDING_REVIEW,
            PtPlayerConsentStatus.APPROVED,
          ],
        })
        .execute();

      return {
        revoked: true,
        cascadedConsentCount: cascaded.affected ?? 0,
      };
    });
  }
}
