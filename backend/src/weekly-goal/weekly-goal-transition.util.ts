import { ChallengeStatus } from '../challenges/entities/challenge.entity';

// ADR-0005 Decision 2's state machine: draft -> active, active -> completed,
// active -> cancelled only. Extracted as a pure function (no exceptions, no
// I/O) so it's trivially unit-testable for every legal/illegal transition,
// the same way common/streak/streak.util.ts isolates the streak-transition
// rule from WeeklyGoalService's DB/transaction plumbing.
//
// A same-status "transition" (e.g. PATCHing status: 'active' while already
// active) is deliberately NOT treated as a legal no-op — the contract
// enumerates exactly three legal edges and nothing else, so anything not in
// this set (including a self-loop) is illegal.
const LEGAL_TRANSITIONS: ReadonlySet<string> = new Set([
  `${ChallengeStatus.DRAFT}->${ChallengeStatus.ACTIVE}`,
  `${ChallengeStatus.ACTIVE}->${ChallengeStatus.COMPLETED}`,
  `${ChallengeStatus.ACTIVE}->${ChallengeStatus.CANCELLED}`,
]);

export function isLegalWeeklyGoalTransition(
  from: ChallengeStatus,
  to: ChallengeStatus,
): boolean {
  return LEGAL_TRANSITIONS.has(`${from}->${to}`);
}
