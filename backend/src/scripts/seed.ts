// Phase 1 seed script — creates the minimum data a coach-mediated onboarding
// step would otherwise need, since Coach self-serve team/invite-code
// creation is out of scope for Phase 1 (docs/api/phase1-contract.md).
// Idempotent: safe to re-run against the same database.
//
// Usage: `pnpm run seed` (reads DATABASE_URL from .env, same as migrations).
import dataSource from '../database/data-source';
import { Coach } from '../coaches/entities/coach.entity';
import {
  ConsentMethod,
  ParentalConsentRecord,
} from '../player-private-info/entities/parental-consent-record.entity';
import { PlayerPrivateInfo } from '../player-private-info/entities/player-private-info.entity';
import { Player } from '../players/entities/player.entity';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { Team } from '../teams/entities/team.entity';
import { TeamCoach } from '../teams/entities/team-coach.entity';
import { Season } from '../team-pool/entities/season.entity';
import { TeamSeasonPot } from '../team-pool/entities/team-season-pot.entity';
import { TeamSeasonPotStatus } from '../team-pool/team-season-pot-status.enum';
import { DEFAULT_TEAM_SEASON_POT_GOAL_THRESHOLD } from '../team-pool/team-season-pot-defaults';

const SEED_INVITE_CODE = 'FALKEN13';
const SEED_TEAM_NAME = 'IBK Falken P13';
const SEED_COACH_EMAIL = 'coach@ibkfalken.example';
const SEED_SEASON_LABEL = 'Vår 2026';

// Phase 2 (ADR-0005): "Kapten is assigned manually — a seed/admin action,
// same posture Phase 1 took with team/invite-code creation." This creates
// one player purely so the weekly-goal/roster/session-reissue endpoints
// are exercisable without a manual DB step or a real onboarding round-trip
// — parental consent is pre-approved (not just is_captain=true) so this
// player can also immediately log training. A real deployment would flag
// an *existing*, already-onboarded player as captain instead (see
// ADR-0005's "reassigning captaincy" note); a from-scratch seed player is
// the boring choice here, mirroring how the rest of this script creates
// fixtures rather than requiring a live signup first.
const SEED_CAPTAIN_SCREEN_NAME = 'KaptenAnna';
const SEED_CAPTAIN_AVATAR_ID = 'fox';
const SEED_CAPTAIN_BIRTH_YEAR = 2013;
const SEED_CAPTAIN_PARENT_CONTACT = 'kapten-parent@ibkfalken.example';

async function run(): Promise<void> {
  await dataSource.initialize();

  const coachRepo = dataSource.getRepository(Coach);
  const teamRepo = dataSource.getRepository(Team);
  const teamCoachRepo = dataSource.getRepository(TeamCoach);
  const seasonRepo = dataSource.getRepository(Season);
  const potRepo = dataSource.getRepository(TeamSeasonPot);
  const playerRepo = dataSource.getRepository(Player);
  const privateInfoRepo = dataSource.getRepository(PlayerPrivateInfo);
  const consentRecordRepo = dataSource.getRepository(ParentalConsentRecord);

  let team = await teamRepo.findOne({
    where: { inviteCode: SEED_INVITE_CODE },
  });

  if (!team) {
    let coach = await coachRepo.findOne({
      where: { email: SEED_COACH_EMAIL },
    });
    if (!coach) {
      coach = await coachRepo.save(
        coachRepo.create({
          email: SEED_COACH_EMAIL,
          displayName: 'Coach Falken',
        }),
      );
      console.log(`Created coach ${coach.id} (${coach.email})`);
    }

    team = await teamRepo.save(
      teamRepo.create({ name: SEED_TEAM_NAME, inviteCode: SEED_INVITE_CODE }),
    );
    console.log(
      `Created team ${team.id} (${team.name}), invite_code=${team.inviteCode}`,
    );

    await teamCoachRepo.save(
      teamCoachRepo.create({ teamId: team.id, coachId: coach.id }),
    );

    const season = await seasonRepo.save(
      seasonRepo.create({
        teamId: team.id,
        label: SEED_SEASON_LABEL,
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      }),
    );
    console.log(`Created season ${season.id} (${season.label})`);

    const pot = await potRepo.save(
      potRepo.create({
        teamId: team.id,
        seasonId: season.id,
        pointsTotal: 0,
        goalThreshold: DEFAULT_TEAM_SEASON_POT_GOAL_THRESHOLD,
        status: TeamSeasonPotStatus.ACTIVE,
      }),
    );
    // Fas 2.7 (ADR-0008 Decision 4): goal_threshold is still a required
    // column (kept, unused, per the ADR) but no response surfaces a
    // "percent toward it" framing anymore — the printed summary shouldn't
    // imply otherwise.
    console.log(
      `Created active TeamSeasonPot ${pot.id} (points_total=0, goal_threshold=${pot.goalThreshold} [unused dormant column, see ADR-0008])`,
    );
  } else {
    console.log(
      `Team with invite code ${SEED_INVITE_CODE} already exists (${team.id}) — skipping team/coach/season/pot seed.`,
    );
  }

  // Phase 2 (ADR-0005): checked independently of the team/coach/season/pot
  // block above so re-running this script against an already-seeded
  // database (the common case once a team exists from a prior Phase 1
  // run) still ensures a captain exists — this script is meant to stay
  // idempotent and safe to re-run, per the file-level comment.
  const existingCaptain = await playerRepo.findOne({
    where: { teamId: team.id, isCaptain: true },
  });
  if (!existingCaptain) {
    const captain = await playerRepo.save(
      playerRepo.create({
        teamId: team.id,
        screenName: SEED_CAPTAIN_SCREEN_NAME,
        avatarId: SEED_CAPTAIN_AVATAR_ID,
        birthYear: SEED_CAPTAIN_BIRTH_YEAR,
        parentalConsentStatus: ParentalConsentStatus.APPROVED,
        isCaptain: true,
      }),
    );
    await privateInfoRepo.save(
      privateInfoRepo.create({
        playerId: captain.id,
        parentContact: SEED_CAPTAIN_PARENT_CONTACT,
        realName: null,
      }),
    );
    await consentRecordRepo.save(
      consentRecordRepo.create({
        playerId: captain.id,
        status: ParentalConsentStatus.APPROVED,
        method: ConsentMethod.IN_APP_BY_PARENT_ACCOUNT,
      }),
    );
    console.log(
      `Created captain player ${captain.id} (${captain.screenName}), is_captain=true, consent=approved`,
    );
  } else {
    console.log(
      `Team ${team.id} already has a captain (${existingCaptain.screenName}) — skipping.`,
    );
  }

  console.log(`\nSeed complete. Invite code for the app: ${SEED_INVITE_CODE}`);

  await dataSource.destroy();
}

run().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
