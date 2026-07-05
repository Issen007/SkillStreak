// Points-per-log formula. Not specified by docs/api/phase1-contract.md or
// ADR-0002 — this is a deliberate, explicit assumption made in Phase 1: 1
// team point per minute trained, flat across activity types. It's simple,
// transparent to a coach/parent looking at the numbers, and easy to
// replace with per-activity multipliers or a captain/coach-configurable
// rate without touching the transaction/locking logic around it. Flagged in
// the original handoff report as a deviation to confirm with the architect/
// coach; Phase 2's kapten pivot (ADR-0005) built its own bonus formula on
// top of this one (see WeeklyGoalService.processGoalBonusForLog) but never
// revisited this base per-minute rate — still open, not silently baked in
// as if it were spec.
export function pointsForTrainingLog(durationMinutes: number): number {
  return durationMinutes;
}
