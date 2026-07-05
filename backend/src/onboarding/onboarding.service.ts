import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PlayerTokenService } from '../auth/player-token.service';
import { ScreenNameTakenException } from '../common/errors/exceptions';
import { ConsentMethod } from '../player-private-info/entities/parental-consent-record.entity';
import { PlayerPrivateInfoService } from '../player-private-info/player-private-info.service';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { PlayersService } from '../players/players.service';
import { TeamsService } from '../teams/teams.service';
import { CreatePlayerDto } from './dto/create-player.dto';

const POSTGRES_UNIQUE_VIOLATION = '23505';

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

interface CreatePlayerResult {
  playerId: string;
  teamId: string;
  screenName: string;
  avatarId: string;
  consentStatus: ParentalConsentStatus;
  sessionToken: string;
}

// Orchestrates the onboarding "shell" step across three modules
// (Team lookup, Player row, PlayerPrivateInfo + consent record) in one
// Postgres transaction. This is the one place allowed to depend on BOTH
// PlayersModule and PlayerPrivateInfoModule — PlayersModule itself must
// never import PlayerPrivateInfoModule (docs/adr/0002 addendum §1).
@Injectable()
export class OnboardingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly teamsService: TeamsService,
    private readonly playersService: PlayersService,
    private readonly playerPrivateInfoService: PlayerPrivateInfoService,
    private readonly playerTokenService: PlayerTokenService,
  ) {}

  async createPlayer(dto: CreatePlayerDto): Promise<CreatePlayerResult> {
    // Read outside the transaction: a 404 here doesn't need transactional
    // isolation, and failing fast avoids opening a transaction for a
    // request that can't possibly succeed.
    const team = await this.teamsService.findByInviteCodeOrThrow(
      dto.inviteCode,
    );

    // Age-band nuance (13+ self-consent under Swedish GDPR Art. 8) is
    // flagged, not resolved, per ADR-0002 addendum §2 — security-reviewer
    // to confirm before this ships. The mechanism (email_link vs.
    // in_app_by_parent_account) already anticipates it; Phase 1 always
    // requests via email_link pending that legal confirmation.
    const consentMethod = ConsentMethod.EMAIL_LINK;

    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const player = await this.playersService.createShell(manager, {
          teamId: team.id,
          screenName: dto.screenName,
          avatarId: dto.avatarId,
          birthYear: dto.birthYear,
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

        return player;
      });

      // TODO(backend-developer, out of scope for this task): actually send
      // a consent request to dto.parentContact (email/SMS) here, outside
      // the transaction, now that the row exists. Phase 1 only creates the
      // ParentalConsentRecord; approval itself happens out-of-band via
      // GET/POST /api/v1/consent/:consentToken (not part of this app's
      // contract, per docs/api/phase1-contract.md step 6).

      return {
        playerId: result.id,
        teamId: result.teamId,
        screenName: result.screenName,
        avatarId: result.avatarId,
        consentStatus: result.parentalConsentStatus,
        sessionToken: this.playerTokenService.issueFor(result.id),
      };
    } catch (error) {
      if (isScreenNameUniqueViolation(error)) {
        throw new ScreenNameTakenException();
      }
      throw error;
    }
  }
}

function isScreenNameUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const pgError = error as { code?: string; constraint?: string };
  return (
    pgError.code === POSTGRES_UNIQUE_VIOLATION &&
    pgError.constraint === PLAYER_SCREEN_NAME_UNIQUE_CONSTRAINT
  );
}
