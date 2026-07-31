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

// docs/adr/0016-cross-team-leaderboard-fairness.md Decision 2's shrinkage
// formula — a pure function, tested directly against the ADR's own worked
// example (four teams, matching the backlog's 3-4-vs-15 framing) rather
// than only through an e2e round-trip, same posture as
// computeStandardCompetitionRanks above.
describe('TeamPoolService.computeEffortLeaderboard', () => {
  // The ADR's worked example: A n=15/3000, C n=10/1800, B n=4/1200,
  // D n=6/900. C (league mean) = 6900/35 ≈ 197.1, k = median(15,10,4,6)=8.
  // Exact math (not the ADR's own display-rounded arithmetic, which its own
  // "illustrative math... not something to hand-verify against" note
  // flags as approximate — see adjustedScore = (7*pointsTotal + 11040) /
  // (7*(n+8)) derived from the formula): A ≈199.0, B ≈231.4, C ≈187.6,
  // D ≈176.9 — all within 0.15 of the ADR's own rounded table (231.5,
  // 199.0, 187.5, 176.9), and the qualitative claim the ADR leads with
  // (team B, n=4, moves from last-by-raw-total to first-by-effort) holds
  // exactly.
  const worked = [
    { teamId: 'a', teamName: 'A', pointsTotal: 3000, eligiblePlayerCount: 15 },
    { teamId: 'c', teamName: 'C', pointsTotal: 1800, eligiblePlayerCount: 10 },
    { teamId: 'b', teamName: 'B', pointsTotal: 1200, eligiblePlayerCount: 4 },
    { teamId: 'd', teamName: 'D', pointsTotal: 900, eligiblePlayerCount: 6 },
  ];

  it('matches the ADR worked example: team B (n=4) moves from last-by-raw-total to first-by-effort', () => {
    const result = TeamPoolService.computeEffortLeaderboard(worked);
    const byTeam = new Map(result.map((row) => [row.teamId, row]));

    expect(byTeam.get('b')!.adjustedScore).toBeCloseTo(231.4, 1);
    expect(byTeam.get('a')!.adjustedScore).toBeCloseTo(199.0, 1);
    expect(byTeam.get('c')!.adjustedScore).toBeCloseTo(187.6, 1);
    expect(byTeam.get('d')!.adjustedScore).toBeCloseTo(176.9, 1);

    expect(byTeam.get('b')!.pointsPerPlayer).toBe(300);
    expect(byTeam.get('a')!.pointsPerPlayer).toBe(200);
    expect(byTeam.get('c')!.pointsPerPlayer).toBe(180);
    expect(byTeam.get('d')!.pointsPerPlayer).toBe(150);

    // Effort rank order: B (smallest roster, highest raw rate) first,
    // A/C/D following — the exact reordering the ADR's backlog complaint
    // asks for (a 15-person team no longer automatically wins).
    expect(result.map((row) => row.teamId)).toEqual(['b', 'a', 'c', 'd']);
    expect(result.map((row) => row.rank)).toEqual([1, 2, 3, 4]);
  });

  it('excludes teams with eligiblePlayerCount === 0 entirely, and they do not affect C/k for the remaining teams', () => {
    const withZero = [
      ...worked,
      { teamId: 'e', teamName: 'E', pointsTotal: 0, eligiblePlayerCount: 0 },
    ];
    const result = TeamPoolService.computeEffortLeaderboard(withZero);
    expect(result.find((row) => row.teamId === 'e')).toBeUndefined();
    expect(result).toHaveLength(4);
    // Same adjustedScores as the four-team case above — team E's presence
    // (0 points, 0 players) must not shift C or k for anyone else.
    const byTeam = new Map(result.map((row) => [row.teamId, row]));
    expect(byTeam.get('b')!.adjustedScore).toBeCloseTo(231.4, 1);
  });

  it('returns an empty array when every team has eligiblePlayerCount === 0', () => {
    const result = TeamPoolService.computeEffortLeaderboard([
      { teamId: 'a', teamName: 'A', pointsTotal: 500, eligiblePlayerCount: 0 },
    ]);
    expect(result).toEqual([]);
  });

  it('applies standard-competition-ranking tie-handling: two teams tied on adjustedScore both share the lower rank, the next distinct score skips', () => {
    // Two teams with identical n and pointsTotal produce an identical
    // adjustedScore by construction.
    const rows = [
      { teamId: 'a', teamName: 'A', pointsTotal: 1000, eligiblePlayerCount: 5 },
      { teamId: 'b', teamName: 'B', pointsTotal: 1000, eligiblePlayerCount: 5 },
      { teamId: 'c', teamName: 'C', pointsTotal: 200, eligiblePlayerCount: 5 },
    ];
    const result = TeamPoolService.computeEffortLeaderboard(rows);
    expect(result.map((row) => row.rank)).toEqual([1, 1, 3]);
    // Stable secondary tie-break: lower teamId first among exact ties.
    expect(result.map((row) => row.teamId)).toEqual(['a', 'b', 'c']);
  });

  it('the k floor: GREATEST(3, median) applies when every team has a tiny roster', () => {
    // median(1,1,2) = 1, floored to k = 3.
    const rows = [
      { teamId: 'a', teamName: 'A', pointsTotal: 100, eligiblePlayerCount: 1 },
      { teamId: 'b', teamName: 'B', pointsTotal: 50, eligiblePlayerCount: 1 },
      { teamId: 'c', teamName: 'C', pointsTotal: 90, eligiblePlayerCount: 2 },
    ];
    // C (league mean) = 240/4 = 60. k = 3.
    // Team A: n=1, teamAverage=100, adjustedScore = (1/4)*100 + (3/4)*60 = 70.
    const result = TeamPoolService.computeEffortLeaderboard(rows);
    const byTeam = new Map(result.map((row) => [row.teamId, row]));
    expect(byTeam.get('a')!.adjustedScore).toBeCloseTo(70, 1);
  });

  it('a single qualifying team gets adjustedScore === its own teamAverage — C collapses to that team, shrinkage has nothing to pull toward', () => {
    const result = TeamPoolService.computeEffortLeaderboard([
      { teamId: 'a', teamName: 'A', pointsTotal: 450, eligiblePlayerCount: 3 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].pointsPerPlayer).toBe(150);
    expect(result[0].adjustedScore).toBeCloseTo(150, 1);
    expect(result[0].rank).toBe(1);
  });

  it('every qualifying team tied on adjustedScore ranks 1 — no gaps, no arbitrary ordering beyond the teamId tie-break', () => {
    const rows = [
      { teamId: 'z', teamName: 'Z', pointsTotal: 400, eligiblePlayerCount: 4 },
      { teamId: 'y', teamName: 'Y', pointsTotal: 400, eligiblePlayerCount: 4 },
      { teamId: 'x', teamName: 'X', pointsTotal: 400, eligiblePlayerCount: 4 },
    ];
    const result = TeamPoolService.computeEffortLeaderboard(rows);
    expect(result.map((row) => row.rank)).toEqual([1, 1, 1]);
    expect(result.map((row) => row.teamId)).toEqual(['x', 'y', 'z']);
  });
});

// docs/adr/0016-cross-team-leaderboard-fairness.md's 2026-07-31 addendum —
// the small-team consent-status-leak fix. Pure function, boundary-tested
// directly (n=2/n=3 is the '1-2'/'3-5' boundary, n=5/n=6 is the '3-5'/'6+'
// boundary).
describe('TeamPoolService.bucketEligiblePlayerCount', () => {
  it('n=1 buckets to 1-2', () => {
    expect(TeamPoolService.bucketEligiblePlayerCount(1)).toBe('1-2');
  });

  it('n=2 buckets to 1-2 (upper boundary)', () => {
    expect(TeamPoolService.bucketEligiblePlayerCount(2)).toBe('1-2');
  });

  it('n=3 buckets to 3-5 (lower boundary)', () => {
    expect(TeamPoolService.bucketEligiblePlayerCount(3)).toBe('3-5');
  });

  it('n=5 buckets to 3-5 (upper boundary)', () => {
    expect(TeamPoolService.bucketEligiblePlayerCount(5)).toBe('3-5');
  });

  it('n=6 buckets to 6+ (lower boundary)', () => {
    expect(TeamPoolService.bucketEligiblePlayerCount(6)).toBe('6+');
  });

  it('n=100 buckets to 6+', () => {
    expect(TeamPoolService.bucketEligiblePlayerCount(100)).toBe('6+');
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

describe('TeamPoolService.getEffortRankAndEligibleCountOrThrow', () => {
  function buildService(
    rows: Array<{
      teamId: string;
      teamName: string;
      pointsTotal: number;
      eligiblePlayerCount: number;
    }>,
  ) {
    const service = new TeamPoolService(undefined as never, undefined as never);
    jest
      .spyOn(service as never, 'queryActivePotsWithEligibleCounts')
      .mockResolvedValue(rows as never);
    return service;
  }

  it("returns the requesting team's effortRank and eligiblePlayerCount", async () => {
    const service = buildService([
      {
        teamId: 'a',
        teamName: 'A',
        pointsTotal: 3000,
        eligiblePlayerCount: 15,
      },
      {
        teamId: 'c',
        teamName: 'C',
        pointsTotal: 1800,
        eligiblePlayerCount: 10,
      },
      { teamId: 'b', teamName: 'B', pointsTotal: 1200, eligiblePlayerCount: 4 },
      { teamId: 'd', teamName: 'D', pointsTotal: 900, eligiblePlayerCount: 6 },
    ]);
    await expect(
      service.getEffortRankAndEligibleCountOrThrow('b'),
    ).resolves.toEqual({ effortRank: 1, eligiblePlayerCount: 4 });
  });

  it('returns effortRank: null (not a throw) when the requesting team has eligiblePlayerCount 0 — an ordinary, expected state', async () => {
    const service = buildService([
      { teamId: 'a', teamName: 'A', pointsTotal: 100, eligiblePlayerCount: 5 },
      { teamId: 'b', teamName: 'B', pointsTotal: 0, eligiblePlayerCount: 0 },
    ]);
    await expect(
      service.getEffortRankAndEligibleCountOrThrow('b'),
    ).resolves.toEqual({ effortRank: null, eligiblePlayerCount: 0 });
  });

  it('throws when the team is missing from its own eligible-count computation ("can\'t occur given the contract")', async () => {
    const service = buildService([
      { teamId: 'a', teamName: 'A', pointsTotal: 100, eligiblePlayerCount: 5 },
    ]);
    await expect(
      service.getEffortRankAndEligibleCountOrThrow('missing'),
    ).rejects.toThrow();
  });
});
