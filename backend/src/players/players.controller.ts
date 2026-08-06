import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentPlayerId } from '../auth/current-player-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TeamPoolService } from '../team-pool/team-pool.service';
import { TeamsService } from '../teams/teams.service';
import {
  daysBetweenExclusive,
  previousDateString,
  stockholmDateString,
} from '../common/time/stockholm-date.util';
import { isSelfVerificationAge } from '../common/age/self-verification-age.util';
import { PlayerLocale } from '../common/locale/player-locale.enum';
import { computeStreakUpdate } from '../common/streak/streak.util';
import { PlayersService } from './players.service';

interface PlayerMeResponse {
  player: {
    id: string;
    screenName: string;
    avatarId: string;
    consentStatus: string;
    // Added 2026-07-27 for age-banded self-verification (13+) — lets
    // WaitingCard/O5ConsentAsk show "verify your own email" copy instead
    // of "waiting for a parent" without the client needing to duplicate
    // isSelfVerificationAge's own birth-year math. Derived server-side;
    // the raw birthYear itself isn't exposed here, only this boolean.
    isSelfVerification: boolean;
    // Added 2026-07-27 for captain approval of new team joins — a second,
    // independent gate alongside consentStatus above (see
    // docs/adr/0009-self-service-team-creation.md's 2026-07-27 addendum).
    teamJoinStatus: string;
    // ADR-0014 Decision 2 — the post-auth "server value is source of
    // truth" flip: this is the one call every AppShell mount already
    // makes (`ensureIdentity`), so it's the actual restore point for a
    // returning player's saved locale, not just a Profile-screen-only
    // fetch of `GET /players/me/profile`.
    locale: PlayerLocale;
  };
  team: {
    teamId: string;
    teamName: string;
  };
  streak: {
    currentStreakCount: number;
    longestStreakCount: number;
    lastTrainedDate: string | null;
    alreadyLoggedToday: boolean;
    // docs/adr/0024-streak-savers.md API sketch — additive, both read-only
    // previews (Decision 5): bankedStreakSaverCount is the raw stored
    // balance (same "straight from Postgres" posture as every other field
    // in this block); pendingStreakGap is derived by re-running the same
    // pure computeStreakUpdate function used at write time against the
    // live stored state, then discarded — nothing here is ever persisted.
    bankedStreakSaverCount: number;
    pendingStreakGap: {
      missedDayCount: number;
      coverableWithBankedSavers: boolean;
    } | null;
  };
  // Fas 2.7 (ADR-0008 Decision 4): goalThreshold/percentComplete removed,
  // rank/teamCount added — see TeamPoolService.getRankAndTeamCountOrThrow.
  // ADR-0016 Decision 5 (additive): effortRank/eligiblePlayerCount added
  // alongside — see TeamPoolService.getEffortRankAndEligibleCountOrThrow.
  teamPool: {
    seasonId: string;
    seasonLabel: string;
    pointsTotal: number;
    status: string;
    rank: number;
    teamCount: number;
    effortRank: number | null;
    eligiblePlayerCount: number;
  };
}

@Controller('api/v1/players')
export class PlayersController {
  constructor(
    private readonly playersService: PlayersService,
    private readonly teamsService: TeamsService,
    private readonly teamPoolService: TeamPoolService,
  ) {}

  // The combined home-screen fetch — mirrors training-logs' "no second
  // round-trip" principle, per docs/api/phase1-contract.md.
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@CurrentPlayerId() playerId: string): Promise<PlayerMeResponse> {
    const player = await this.playersService.findByIdOrThrow(playerId);
    const team = await this.teamsService.findById(player.teamId);
    if (!team) {
      // Can't occur given the API contract (team_id is a validated FK set
      // at onboarding time) — surfaced as a 500 rather than defended
      // against as if it were normal client input.
      throw new Error(
        `Player ${playerId} references missing team ${player.teamId}`,
      );
    }
    const pot = await this.teamPoolService.getActivePotForTeam(player.teamId);
    const season = await this.teamPoolService.getSeason(pot.seasonId);
    if (!season) {
      throw new Error(
        `TeamSeasonPot ${pot.id} references missing season ${pot.seasonId}`,
      );
    }

    const { rank, teamCount } =
      await this.teamPoolService.getRankAndTeamCountOrThrow(player.teamId);
    const { effortRank, eligiblePlayerCount } =
      await this.teamPoolService.getEffortRankAndEligibleCountOrThrow(
        player.teamId,
      );

    const today = stockholmDateString();
    // Derived straight from Postgres (the source of truth), same as the
    // training-logs write path's alreadyLoggedToday — Redis's copy of this
    // is a write-path accelerator for other consumers, not read here.
    const alreadyLoggedToday = player.lastTrainedDate === today;

    // docs/adr/0024-streak-savers.md Decision 5 — a read-only preview, NOT
    // a mutation: no transaction, no row lock, no write, on this app's
    // hottest read endpoint. Re-runs the exact same pure computeStreakUpdate
    // function the write path uses (TrainingLogsService.logTraining),
    // against the already-fetched `player` row above, and discards
    // everything about its result except whether a currently-open gap
    // would be bridged by the banked balance — the actually-stored streak
    // fields (above) remain this response's source of truth throughout.
    const yesterday = previousDateString(today);
    const hasOpenGap =
      !alreadyLoggedToday &&
      player.lastTrainedDate !== null &&
      player.lastTrainedDate !== yesterday;
    let pendingStreakGap: {
      missedDayCount: number;
      coverableWithBankedSavers: boolean;
    } | null = null;
    if (hasOpenGap) {
      const preview = computeStreakUpdate(
        {
          currentStreakCount: player.currentStreakCount,
          longestStreakCount: player.longestStreakCount,
          lastTrainedDate: player.lastTrainedDate,
          bankedStreakSaverCount: player.bankedStreakSaverCount,
        },
        today,
      );
      pendingStreakGap = {
        missedDayCount: daysBetweenExclusive(
          player.lastTrainedDate as string,
          today,
        ),
        coverableWithBankedSavers: preview.streakSaversSpent > 0,
      };
    }

    return {
      player: {
        id: player.id,
        screenName: player.screenName,
        avatarId: player.avatarId,
        consentStatus: player.parentalConsentStatus,
        isSelfVerification: isSelfVerificationAge(player.birthYear),
        teamJoinStatus: player.teamJoinStatus,
        locale: player.locale,
      },
      team: {
        teamId: team.id,
        teamName: team.name,
      },
      streak: {
        currentStreakCount: player.currentStreakCount,
        longestStreakCount: player.longestStreakCount,
        lastTrainedDate: player.lastTrainedDate,
        alreadyLoggedToday,
        bankedStreakSaverCount: player.bankedStreakSaverCount,
        pendingStreakGap,
      },
      teamPool: {
        seasonId: season.id,
        seasonLabel: season.label,
        pointsTotal: pot.pointsTotal,
        status: pot.status,
        rank,
        teamCount,
        effortRank,
        eligiblePlayerCount,
      },
    };
  }
}
