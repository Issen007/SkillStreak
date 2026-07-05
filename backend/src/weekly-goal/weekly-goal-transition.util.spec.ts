import { ChallengeStatus } from '../challenges/entities/challenge.entity';
import { isLegalWeeklyGoalTransition } from './weekly-goal-transition.util';

// ADR-0005 Decision 2 / docs/api/phase2-contract.md: exactly three legal
// edges (draft -> active, active -> completed, active -> cancelled) and
// nothing else — exercised exhaustively over every ordered pair of
// statuses, not just the "obviously legal" ones, per the task's "all
// legal/illegal transitions" requirement.
describe('isLegalWeeklyGoalTransition', () => {
  const ALL_STATUSES = Object.values(ChallengeStatus);

  it.each([
    [ChallengeStatus.DRAFT, ChallengeStatus.ACTIVE],
    [ChallengeStatus.ACTIVE, ChallengeStatus.COMPLETED],
    [ChallengeStatus.ACTIVE, ChallengeStatus.CANCELLED],
  ])('%s -> %s is legal', (from, to) => {
    expect(isLegalWeeklyGoalTransition(from, to)).toBe(true);
  });

  it.each([
    [ChallengeStatus.DRAFT, ChallengeStatus.COMPLETED],
    [ChallengeStatus.DRAFT, ChallengeStatus.CANCELLED],
    [ChallengeStatus.COMPLETED, ChallengeStatus.ACTIVE],
    [ChallengeStatus.CANCELLED, ChallengeStatus.ACTIVE],
    [ChallengeStatus.COMPLETED, ChallengeStatus.CANCELLED],
    [ChallengeStatus.CANCELLED, ChallengeStatus.COMPLETED],
    [ChallengeStatus.ACTIVE, ChallengeStatus.DRAFT],
  ])('%s -> %s is illegal', (from, to) => {
    expect(isLegalWeeklyGoalTransition(from, to)).toBe(false);
  });

  it('rejects every same-status "transition" (no self-loop is legal, including draft -> draft)', () => {
    for (const status of ALL_STATUSES) {
      expect(isLegalWeeklyGoalTransition(status, status)).toBe(false);
    }
  });

  it('rejects every ordered pair not in the fixed legal set (exhaustive over the full status x status matrix)', () => {
    const legalPairs = new Set([
      `${ChallengeStatus.DRAFT}->${ChallengeStatus.ACTIVE}`,
      `${ChallengeStatus.ACTIVE}->${ChallengeStatus.COMPLETED}`,
      `${ChallengeStatus.ACTIVE}->${ChallengeStatus.CANCELLED}`,
    ]);
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const expected = legalPairs.has(`${from}->${to}`);
        expect(isLegalWeeklyGoalTransition(from, to)).toBe(expected);
      }
    }
  });
});
