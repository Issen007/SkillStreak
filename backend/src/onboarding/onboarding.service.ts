import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { PlayerTokenService } from '../auth/player-token.service';
import {
  InviteCodeNotFoundException,
  InviteCodeTakenConcurrentlyException,
  ScreenNameTakenException,
} from '../common/errors/exceptions';
import { isPostgresUniqueViolation } from '../common/errors/postgres-error.util';
import { isSelfVerificationAge } from '../common/age/self-verification-age.util';
import { MailService } from '../mail/mail.service';
import { buildConsentRequestEmail } from '../mail/templates/consent-request-email.template';
import { buildSelfVerificationEmail } from '../mail/templates/self-verification-email.template';
import { ConsentMethod } from '../player-private-info/entities/parental-consent-record.entity';
import { PlayerPrivateInfoService } from '../player-private-info/player-private-info.service';
import { generateConsentToken } from '../players/consent-token.util';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { TeamJoinStatus } from '../players/team-join-status.enum';
import { PlayersService } from '../players/players.service';
import { TeamPoolService } from '../team-pool/team-pool.service';
import { Team } from '../teams/entities/team.entity';
import { TeamsService } from '../teams/teams.service';
import { CreatePlayerDto } from './dto/create-player.dto';

const DEFAULT_APP_PUBLIC_URL = 'http://localhost:3000';

// The unique index backing Player's (team_id, screen_name) uniqueness, per
// the @Index(['teamId', 'screenName'], { unique: true }) decorator on the
// Player entity and its corresponding
// `CREATE UNIQUE INDEX "IDX_b3c76b4d48cefcb7aa46feb1ee" ON "player"
// ("team_id", "screen_name")` in the InitialSchema migration. Postgres
// reports this index name in a 23505 error's `constraint` field even though
// it was created as a bare unique index rather than a named `ADD CONSTRAINT
// ... UNIQUE` — checking it here (not just the 23505 code) means a future
// unique constraint added elsewhere in this same transaction can't be
// silently mislabeled as `screen_name_taken_in_team`.
const PLAYER_SCREEN_NAME_UNIQUE_CONSTRAINT = 'IDX_b3c76b4d48cefcb7aa46feb1ee';

// The unique constraint backing Team.invite_code (see team.entity.ts's
// `unique: true` column option), named `UQ_da387f0c2e17d1e1e09f2836adf` in
// the InitialSchema migration (a plain ALTER TABLE ... ADD CONSTRAINT ...
// UNIQUE, so this is TypeORM's auto-generated hash name, not a hand-picked
// one — see docs/adr/0009-self-service-team-creation.md Decision 8). Only
// reachable via TeamsService.createTeam's INSERT, inside this service's own
// transaction below.
const TEAM_INVITE_CODE_UNIQUE_CONSTRAINT = 'UQ_da387f0c2e17d1e1e09f2836adf';

interface CreatePlayerResult {
  playerId: string;
  teamId: string;
  teamName: string;
  teamCreated: boolean;
  isCaptain: boolean;
  screenName: string;
  avatarId: string;
  consentStatus: ParentalConsentStatus;
  isSelfVerification: boolean;
  teamJoinStatus: TeamJoinStatus;
  sessionToken: string;
}

// Orchestrates the onboarding "shell" step across three modules
// (Team lookup, Player row, PlayerPrivateInfo + consent record) in one
// Postgres transaction. This is the one place allowed to depend on BOTH
// PlayersModule and PlayerPrivateInfoModule — PlayersModule itself must
// never import PlayerPrivateInfoModule (docs/adr/0002 addendum §1).
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly teamsService: TeamsService,
    private readonly teamPoolService: TeamPoolService,
    private readonly playersService: PlayersService,
    private readonly playerPrivateInfoService: PlayerPrivateInfoService,
    private readonly playerTokenService: PlayerTokenService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * docs/adr/0009-self-service-team-creation.md Decision 2's server-side
   * algorithm. The invite-code lookup stays outside the transaction (as
   * before Fas 2.9 — a 404 here doesn't need transactional isolation, and
   * failing fast avoids opening a transaction for a request that can't
   * possibly succeed) — but a `null` result is no longer automatically a
   * 404: if the client also supplied `teamName`, this becomes the
   * create-a-team path instead, resolved inside the transaction below.
   */
  async createPlayer(dto: CreatePlayerDto): Promise<CreatePlayerResult> {
    const existingTeam = await this.teamsService.findByInviteCode(
      dto.inviteCode,
    );
    if (!existingTeam && !dto.teamName) {
      // Unchanged Phase 1 behavior: no team, and the client hasn't opted
      // into creating one.
      throw new InviteCodeNotFoundException();
    }

    // Age-band self-verification (13+, Swedish GDPR Art. 8's actual legal
    // minimum) — resolved 2026-07-27 per docs/adr/0002-data-model.md
    // addendum §2's 2026-07-27 update. Below 13, unchanged: a parent must
    // approve via the third-person consent-request email. At 13+, the
    // player verifies their own account instead — same underlying
    // mechanism (a token + email link + approve), different audience and
    // copy (see self-verification-email.template.ts /
    // consent-page.templates.ts's render*SelfVerification* functions).
    const selfVerification = isSelfVerificationAge(dto.birthYear);
    const consentMethod = selfVerification
      ? ConsentMethod.SELF_EMAIL_LINK
      : ConsentMethod.EMAIL_LINK;

    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const { team, teamCreated } = await this.resolveTeam(
          manager,
          existingTeam,
          dto,
        );

        const player = await this.playersService.createShell(manager, {
          teamId: team.id,
          screenName: dto.screenName,
          avatarId: dto.avatarId,
          birthYear: dto.birthYear,
          // The ONLY place isCaptain is ever set true at shell-creation
          // time — true if and only if this exact request just created the
          // team (ADR-0009 Decision 2/7).
          isCaptain: teamCreated,
        });

        await this.playerPrivateInfoService.createForNewPlayer(
          manager,
          player.id,
          dto.parentContact,
        );

        await this.playerPrivateInfoService.recordConsentEvent(
          manager,
          player.id,
          ParentalConsentStatus.PENDING,
          consentMethod,
        );

        const { token, expiresAt } = generateConsentToken();
        await this.playersService.setConsentToken(
          manager,
          player.id,
          token,
          expiresAt,
        );

        return { player, consentToken: token, team, teamCreated };
      });

      // Best-effort: mail sending must never block or fail account
      // creation (the onboarding "shell" step is meant to be fast and
      // friction-free — see ADR-0002 addendum §2). If MailService is a
      // no-op (SMTP not configured) or the send throws, this just logs and
      // moves on; the parent can still be reached another way, and the
      // token/row already exist for a resend.
      const appPublicUrl =
        this.configService.get<string>('APP_PUBLIC_URL') ??
        DEFAULT_APP_PUBLIC_URL;
      const consentUrl = `${appPublicUrl}/api/v1/consent/${result.consentToken}`;
      const email = selfVerification
        ? buildSelfVerificationEmail({
            screenName: result.player.screenName,
            teamName: result.team.name,
            consentUrl,
          })
        : buildConsentRequestEmail({
            screenName: result.player.screenName,
            teamName: result.team.name,
            consentUrl,
          });
      try {
        await this.mailService.sendMail({
          to: dto.parentContact,
          subject: email.subject,
          html: email.html,
          text: email.text,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Failed to send consent request email for player ${result.player.id}: ${message}`,
        );
      }

      return {
        playerId: result.player.id,
        teamId: result.player.teamId,
        teamName: result.team.name,
        teamCreated: result.teamCreated,
        isCaptain: result.player.isCaptain,
        screenName: result.player.screenName,
        avatarId: result.player.avatarId,
        consentStatus: result.player.parentalConsentStatus,
        isSelfVerification: selfVerification,
        teamJoinStatus: result.player.teamJoinStatus,
        sessionToken: this.playerTokenService.issueFor(
          result.player.id,
          result.player.tokenVersion,
        ),
      };
    } catch (error) {
      if (
        isPostgresUniqueViolation(error, PLAYER_SCREEN_NAME_UNIQUE_CONSTRAINT)
      ) {
        throw new ScreenNameTakenException();
      }
      throw error;
    }
  }

  /**
   * Resolves the team to join, creating one if (and only if) the lookup
   * outside the transaction found nothing — re-checked as `existingTeam ===
   * null` here rather than re-querying, since nothing between that lookup
   * and this call could have made a *found* team disappear. `dto.teamName`
   * is guaranteed present whenever `existingTeam` is null (createPlayer
   * already 404s otherwise). If `existingTeam` *was* found but `teamName`
   * was also (redundantly) supplied, it's silently ignored — ADR-0009
   * Decision 2's explicit "forgive the unimportant mismatch" call.
   */
  private async resolveTeam(
    manager: EntityManager,
    existingTeam: Team | null,
    dto: CreatePlayerDto,
  ): Promise<{ team: Team; teamCreated: boolean }> {
    if (existingTeam) {
      return { team: existingTeam, teamCreated: false };
    }

    let team: Team;
    try {
      team = await this.teamsService.createTeam(manager, {
        // dto.teamName is guaranteed present here — see createPlayer.
        name: dto.teamName as string,
        inviteCode: dto.inviteCode,
      });
    } catch (error) {
      if (
        isPostgresUniqueViolation(error, TEAM_INVITE_CODE_UNIQUE_CONSTRAINT)
      ) {
        // ADR-0009 Decision 8 — an explicit error, not a silent
        // fallback-to-join: two onboarding sessions raced to create a team
        // with the identical not-yet-existing invite code.
        throw new InviteCodeTakenConcurrentlyException();
      }
      throw error;
    }

    await this.teamPoolService.createInitialSeasonAndPot(manager, team.id);
    return { team, teamCreated: true };
  }
}
