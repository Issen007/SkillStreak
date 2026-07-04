// Phase 1 seed script — creates the minimum data a coach-mediated onboarding
// step would otherwise need, since Coach self-serve team/invite-code
// creation is out of scope for Phase 1 (docs/api/phase1-contract.md).
// Idempotent: safe to re-run against the same database.
//
// Usage: `pnpm run seed` (reads DATABASE_URL from .env, same as migrations).
import dataSource from '../database/data-source';
import { Coach } from '../coaches/entities/coach.entity';
import { Team } from '../teams/entities/team.entity';
import { TeamCoach } from '../teams/entities/team-coach.entity';
import { Season } from '../team-pool/entities/season.entity';
import { TeamSeasonPot } from '../team-pool/entities/team-season-pot.entity';
import { TeamSeasonPotStatus } from '../team-pool/team-season-pot-status.enum';

const SEED_INVITE_CODE = 'FALKEN13';
const SEED_TEAM_NAME = 'IBK Falken P13';
const SEED_COACH_EMAIL = 'coach@ibkfalken.example';
const SEED_SEASON_LABEL = 'Vår 2026';

async function run(): Promise<void> {
  await dataSource.initialize();

  const coachRepo = dataSource.getRepository(Coach);
  const teamRepo = dataSource.getRepository(Team);
  const teamCoachRepo = dataSource.getRepository(TeamCoach);
  const seasonRepo = dataSource.getRepository(Season);
  const potRepo = dataSource.getRepository(TeamSeasonPot);

  let team = await teamRepo.findOne({
    where: { inviteCode: SEED_INVITE_CODE },
  });
  if (team) {
    console.log(
      `Team with invite code ${SEED_INVITE_CODE} already exists (${team.id}) — skipping seed.`,
    );
    await dataSource.destroy();
    return;
  }

  let coach = await coachRepo.findOne({ where: { email: SEED_COACH_EMAIL } });
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
      goalThreshold: 5000,
      status: TeamSeasonPotStatus.ACTIVE,
    }),
  );
  console.log(
    `Created active TeamSeasonPot ${pot.id} (goal ${pot.goalThreshold})`,
  );

  console.log(`\nSeed complete. Invite code for the app: ${SEED_INVITE_CODE}`);

  await dataSource.destroy();
}

run().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
