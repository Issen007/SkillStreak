import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PtConsentNotApprovedException } from '../common/errors/exceptions';
import { Badge } from '../badges/entities/badge.entity';
import { BadgeAward } from '../badges/entities/badge-award.entity';
import { Player } from '../players/entities/player.entity';
import { Team } from '../teams/entities/team.entity';
import { TeamPoolService } from '../team-pool/team-pool.service';
import { TrainingLogEntry } from '../training-logs/entities/training-log-entry.entity';
import {
  Challenge,
  ChallengeStatus,
} from '../challenges/entities/challenge.entity';
import { WeeklyGoalService } from '../weekly-goal/weekly-goal.service';
import {
  PtPlayerConsent,
  PtPlayerConsentStatus,
} from './entities/pt-player-consent.entity';
import { PtTeamLink, PtTeamLinkStatus } from './entities/pt-team-link.entity';

export type RosterConsentStatus = 'none' | 'pending_review' | 'approved';

export interface PtTeamAggregateRosterEntry {
  playerId: string;
  screenName: string;
  consentStatus: RosterConsentStatus;
}

export interface PtTeamAggregateView {
  ptTeamLinkId: string;
  teamId: string;
  teamName: string;
  teamPool: {
    pointsTotal: number;
    // No goalThreshold. ADR-0008 Decision 4 replaced the "progress toward
    // a fixed target" framing with a cross-team leaderboard, so the column
    // survives only because it is NOT NULL — it means nothing, and a
    // trainer-facing field that means nothing is worse than an absent one
    // (see ADR-0025's 2026-08-11 amendment). Decision A5's allow-list is
    // meant to be a considered list of what a PT sees, not a passthrough.
  };
  activeWeeklyGoal: {
    title: string;
    description: string;
    targetMetric: string;
    targetValue: number;
    startDate: string;
    endDate: string;
    teamProgressValue: number;
  } | null;
  roster: PtTeamAggregateRosterEntry[];
  rosterSize: number;
}

export interface PtPlayerTrainingDataView {
  screenName: string;
  currentStreakCount: number;
  longestStreakCount: number;
  lastTrainedDate: string | null;
  trainingLog: Array<{
    loggedAt: string;
    activityType: string;
    durationMinutes: number;
  }>;
  badges: Array<{
    key: string;
    displayName: string;
    awardedAt: string;
  }>;
}

// docs/adr/0023-pt-role-and-staff-sso-rbac.md Decision A5 — the fixed,
// argued allow-list, split into the team-aggregate tier (gated on
// PtTeamLink.status = 'active' alone) and the per-player tier (gated on
// PtPlayerConsent.status = 'approved' for that exact pair). Every method
// here requires an explicit, verified (ptStaffAccountId, teamId/playerId)
// pair and re-checks the live relationship status itself — there is no
// method on this service that returns player data without that check
// (Decision A5's "structural enforcement, not just an intended API
// shape").
//
// Deliberately never touches PlayerPrivateInfo (real_name/parent_contact),
// TeamChatMessage, or VideoClip — none of those entities/modules are
// imported here at all, so there is nothing to accidentally wire a filter
// to later (the same structural bar ADR-0022 Decision 5 already set for
// UsageMetricsService, applied in the opposite direction here).
@Injectable()
export class PtDataService {
  constructor(
    private readonly teamPoolService: TeamPoolService,
    private readonly weeklyGoalService: WeeklyGoalService,
    @InjectRepository(PtTeamLink)
    private readonly ptTeamLinkRepository: Repository<PtTeamLink>,
    @InjectRepository(PtPlayerConsent)
    private readonly ptPlayerConsentRepository: Repository<PtPlayerConsent>,
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    @InjectRepository(Player)
    private readonly playerRepository: Repository<Player>,
    @InjectRepository(Challenge)
    private readonly challengeRepository: Repository<Challenge>,
    @InjectRepository(TrainingLogEntry)
    private readonly trainingLogEntryRepository: Repository<TrainingLogEntry>,
    @InjectRepository(Badge)
    private readonly badgeRepository: Repository<Badge>,
    @InjectRepository(BadgeAward)
    private readonly badgeAwardRepository: Repository<BadgeAward>,
  ) {}

  /**
   * Decision A5's team-aggregate tier — one entry per currently-ACTIVE
   * PtTeamLink this PT holds. Deliberately shows the LIVE current roster
   * (Decision A1 point 5's corrected text / security-reviewer Finding 5):
   * a player who joins after the link was created appears here
   * automatically, by design, not a bug.
   */
  async getTeamAggregateViewsForPt(
    ptStaffAccountId: string,
  ): Promise<PtTeamAggregateView[]> {
    const links = await this.ptTeamLinkRepository.find({
      where: { ptStaffAccountId, status: PtTeamLinkStatus.ACTIVE },
    });
    return Promise.all(links.map((link) => this.buildTeamAggregateView(link)));
  }

  private async buildTeamAggregateView(
    link: PtTeamLink,
  ): Promise<PtTeamAggregateView> {
    const team = await this.teamRepository.findOne({
      where: { id: link.teamId },
    });
    const pot = await this.teamPoolService.getActivePotForTeam(link.teamId);
    const roster = await this.playerRepository.find({
      where: { teamId: link.teamId },
    });

    const consentRows = roster.length
      ? await this.ptPlayerConsentRepository.find({
          where: [
            {
              ptStaffAccountId: link.ptStaffAccountId,
              status: PtPlayerConsentStatus.PENDING_REVIEW,
            },
            {
              ptStaffAccountId: link.ptStaffAccountId,
              status: PtPlayerConsentStatus.APPROVED,
            },
          ],
        })
      : [];
    const consentByPlayerId = new Map<string, RosterConsentStatus>();
    for (const row of consentRows) {
      consentByPlayerId.set(
        row.playerId,
        row.status === PtPlayerConsentStatus.APPROVED
          ? 'approved'
          : 'pending_review',
      );
    }

    const activeGoal = await this.challengeRepository.findOne({
      where: { teamId: link.teamId, status: ChallengeStatus.ACTIVE },
    });
    let activeWeeklyGoal: PtTeamAggregateView['activeWeeklyGoal'] = null;
    if (activeGoal) {
      const teamProgressValue =
        await this.weeklyGoalService.computeTeamProgress(
          undefined,
          link.teamId,
          activeGoal.targetMetric,
          activeGoal.startDate,
          activeGoal.endDate,
        );
      activeWeeklyGoal = {
        title: activeGoal.title,
        description: activeGoal.description,
        targetMetric: activeGoal.targetMetric,
        targetValue: activeGoal.targetValue,
        startDate: activeGoal.startDate,
        endDate: activeGoal.endDate,
        teamProgressValue,
      };
    }

    return {
      ptTeamLinkId: link.id,
      teamId: link.teamId,
      teamName: team?.name ?? '',
      teamPool: {
        pointsTotal: pot.pointsTotal,
      },
      activeWeeklyGoal,
      roster: roster.map((player) => ({
        playerId: player.id,
        screenName: player.screenName,
        consentStatus: consentByPlayerId.get(player.id) ?? 'none',
      })),
      rosterSize: roster.length,
    };
  }

  /**
   * Decision A5's per-player tier — re-checks a LIVE `approved`
   * PtPlayerConsent for this exact (pt, player) pair on every call
   * (Decision A4: "never trusts a cached grant"). Field list is exactly
   * the allow-list table: screenName, currentStreakCount/
   * longestStreakCount/lastTrainedDate, TrainingLogEntry history
   * (loggedAt/activityType/durationMinutes), and BadgeAward's
   * badge.key/displayName/awardedAt only — `context` (including its
   * freeform `note` subfield) is never read or returned here, full stop.
   */
  async getPlayerTrainingData(
    ptStaffAccountId: string,
    playerId: string,
  ): Promise<PtPlayerTrainingDataView> {
    const consent = await this.ptPlayerConsentRepository.findOne({
      where: {
        ptStaffAccountId,
        playerId,
        status: PtPlayerConsentStatus.APPROVED,
      },
    });
    if (!consent) {
      throw new PtConsentNotApprovedException();
    }

    const player = await this.playerRepository.findOne({
      where: { id: playerId },
    });
    if (!player) {
      throw new PtConsentNotApprovedException();
    }

    const trainingLogEntries = await this.trainingLogEntryRepository.find({
      where: { playerId },
      order: { loggedAt: 'DESC' },
    });

    const badgeAwards = await this.badgeAwardRepository.find({
      where: { playerId },
      order: { awardedAt: 'DESC' },
    });
    const badgeIds = [...new Set(badgeAwards.map((award) => award.badgeId))];
    const badges = badgeIds.length
      ? await this.badgeRepository.find({ where: { id: In(badgeIds) } })
      : [];
    const badgeById = new Map(badges.map((badge) => [badge.id, badge]));

    return {
      screenName: player.screenName,
      currentStreakCount: player.currentStreakCount,
      longestStreakCount: player.longestStreakCount,
      lastTrainedDate: player.lastTrainedDate,
      trainingLog: trainingLogEntries.map((entry) => ({
        loggedAt: entry.loggedAt.toISOString(),
        activityType: entry.activityType,
        durationMinutes: entry.durationMinutes,
      })),
      badges: badgeAwards
        .map((award) => {
          const badge = badgeById.get(award.badgeId);
          if (!badge) return null;
          return {
            key: badge.key,
            displayName: badge.displayName,
            awardedAt: award.awardedAt.toISOString(),
          };
        })
        .filter(
          (entry): entry is PtPlayerTrainingDataView['badges'][number] =>
            entry !== null,
        ),
    };
  }
}
