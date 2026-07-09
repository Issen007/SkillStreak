import { TeamPoolService } from './team-pool.service';

// ADR-0008 Decision 3 / docs/api/phase2.7-contract.md's own note to
// code-critic: "the rank/tie computation ... is the one piece of
// genuinely new logic here — worth checking directly against a
// hand-worked example with ties." computeStandardCompetitionRanks is a
// pure function (no DB), so it's tested directly here rather than only
// through an e2e round-trip.
describe('TeamPoolService.computeStandardCompetitionRanks', () => {
  it('assigns 1..N with no ties', () => {
    const rows = [
      { teamId: 'a', teamName: 'A', pointsTotal: 300 },
      { teamId: 'b', teamName: 'B', pointsTotal: 200 },
      { teamId: 'c', teamName: 'C', pointsTotal: 100 },
    ];
    expect(TeamPoolService.computeStandardCompetitionRanks(rows)).toEqual([
      { rank: 1, teamId: 'a', teamName: 'A', pointsTotal: 300 },
      { rank: 2, teamId: 'b', teamName: 'B', pointsTotal: 200 },
      { rank: 3, teamId: 'c', teamName: 'C', pointsTotal: 100 },
    ]);
  });

  it("the contract's own worked example: two teams tied at 1800 both rank 2, the next team ranks 4 (not 3)", () => {
    const rows = [
      { teamId: 'a', teamName: 'IBK Härnösand P12', pointsTotal: 2200 },
      { teamId: 'b', teamName: 'Sundsvall Innebandy P13', pointsTotal: 1800 },
      { teamId: 'c', teamName: 'Örnsköldsvik IBK', pointsTotal: 1800 },
      { teamId: 'd', teamName: 'IBK Falken P13', pointsTotal: 1280 },
    ];
    expect(TeamPoolService.computeStandardCompetitionRanks(rows)).toEqual([
      {
        rank: 1,
        teamId: 'a',
        teamName: 'IBK Härnösand P12',
        pointsTotal: 2200,
      },
      {
        rank: 2,
        teamId: 'b',
        teamName: 'Sundsvall Innebandy P13',
        pointsTotal: 1800,
      },
      { rank: 2, teamId: 'c', teamName: 'Örnsköldsvik IBK', pointsTotal: 1800 },
      { rank: 4, teamId: 'd', teamName: 'IBK Falken P13', pointsTotal: 1280 },
    ]);
  });

  it('a three-way tie at the top all rank 1, and the next distinct score ranks 4', () => {
    const rows = [
      { teamId: 'a', teamName: 'A', pointsTotal: 500 },
      { teamId: 'b', teamName: 'B', pointsTotal: 500 },
      { teamId: 'c', teamName: 'C', pointsTotal: 500 },
      { teamId: 'd', teamName: 'D', pointsTotal: 400 },
    ];
    const result = TeamPoolService.computeStandardCompetitionRanks(rows);
    expect(result.map((r) => r.rank)).toEqual([1, 1, 1, 4]);
  });

  it('every team tied gives every team rank 1', () => {
    const rows = [
      { teamId: 'a', teamName: 'A', pointsTotal: 0 },
      { teamId: 'b', teamName: 'B', pointsTotal: 0 },
    ];
    const result = TeamPoolService.computeStandardCompetitionRanks(rows);
    expect(result.map((r) => r.rank)).toEqual([1, 1]);
  });

  it('returns an empty array for an empty leaderboard', () => {
    expect(TeamPoolService.computeStandardCompetitionRanks([])).toEqual([]);
  });
});

describe('TeamPoolService.getRankAndTeamCountOrThrow', () => {
  function buildService(
    leaderboard: Array<{
      rank: number;
      teamId: string;
      teamName: string;
      pointsTotal: number;
    }>,
  ) {
    const service = new TeamPoolService(undefined as never, undefined as never);
    jest.spyOn(service, 'getLeaderboard').mockResolvedValue(leaderboard);
    return service;
  }

  it("returns the matching entry's rank plus the full leaderboard length as teamCount", async () => {
    const service = buildService([
      { rank: 1, teamId: 'a', teamName: 'A', pointsTotal: 100 },
      { rank: 2, teamId: 'b', teamName: 'B', pointsTotal: 50 },
    ]);
    await expect(service.getRankAndTeamCountOrThrow('b')).resolves.toEqual({
      rank: 2,
      teamCount: 2,
    });
  });

  it('throws (surfaced as a 500, per the "can\'t occur given the contract" posture) when the team is missing from its own leaderboard computation', async () => {
    const service = buildService([
      { rank: 1, teamId: 'a', teamName: 'A', pointsTotal: 100 },
    ]);
    await expect(
      service.getRankAndTeamCountOrThrow('missing'),
    ).rejects.toThrow();
  });
});
