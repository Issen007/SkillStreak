// `StreakSaverEvent.event_type` (docs/adr/0024-streak-savers.md Decision 4)
// — 'earned' rows are written on a fresh 7-day streak milestone (unless
// already at the cap, which is a no-op with no row at all); 'spent' rows
// are written one per bridged missed day when a gap is covered by the
// banked balance.
export enum StreakSaverEventType {
  EARNED = 'earned',
  SPENT = 'spent',
}
