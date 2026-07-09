import { MigrationInterface, QueryRunner } from 'typeorm';

// Fas 2.9 (self-service team creation) —
// docs/adr/0009-self-service-team-creation.md Decision 6.
//
// A single partial unique index, same shape/purpose as
// idx_player_one_captain_per_team (AddCaptainWeeklyGoalAndSessionReissue)
// and idx_challenge_one_active_goal_per_team (same migration): "at most one
// active X per team", enforced at the DB level rather than by application
// logic alone. Not exercised by this feature's own write path — every pot
// TeamPoolService.createInitialSeasonAndPot creates belongs to a
// freshly-generated team_id that structurally cannot already have one — but
// this is the first real (non-seed, non-admin-reviewed) pot-creation code
// path in the app, so it's the right moment to close this gap
// docs/ACTION_PLAN.md already flagged as "not reachable while pot creation
// is seed-only, but relevant once Phase 2 builds season rollover." A
// backstop for future code (e.g. an eventual season-rollover feature), not
// a check this feature itself will ever trip.
export class AddTeamSeasonPotOneActivePerTeamIndex1783625457703 implements MigrationInterface {
  name = 'AddTeamSeasonPotOneActivePerTeamIndex1783625457703';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_team_season_pot_one_active_per_team" ON "team_season_pot" ("team_id") WHERE "status" = 'active'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_team_season_pot_one_active_per_team"`,
    );
  }
}
