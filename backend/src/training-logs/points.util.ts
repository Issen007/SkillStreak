// Points-per-log formula. Not specified by docs/api/phase1-contract.md or
// ADR-0002 — this is a deliberate, explicit assumption for Phase 1: 1 team
// point per minute trained, flat across activity types. It's simple,
// transparent to a coach/parent looking at the numbers, and easy to
// replace with per-activity multipliers or a coach-configurable rate in
// Phase 2 without touching the transaction/locking logic around it. Flagged
// in the handoff report as a deviation to confirm with the architect/coach,
// not silently baked in as if it were spec.
export function pointsForTrainingLog(durationMinutes: number): number {
  return durationMinutes;
}
