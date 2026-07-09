// Pure, DB-free — mirrors common/time/stockholm-date.util.ts's shape (see
// CLAUDE.md's "keep individual-streak/pure logic separate" spirit and
// common/streak/'s existing precedent). Computes which Swedish half-year
// season a given calendar date ('YYYY-MM-DD', already resolved to
// Europe/Stockholm by the caller — see stockholmDateString) falls into, per
// docs/adr/0009-self-service-team-creation.md Decision 6: the same
// convention src/scripts/seed.ts already hard-codes ("Vår 2026", Jan 1 -
// Jun 30), generalized so a self-created team's season aligns to the
// identical fixed calendar grid regardless of when the team happens to be
// created — a deliberate choice over a floating "today + N days" window,
// per the ADR, to keep ADR-0008's cross-team leaderboard comparison from
// gaining a second season-shape variable.
export interface HalfYearSeason {
  label: string;
  startDate: string;
  endDate: string;
}

const FIRST_HALF_LAST_MONTH = 6; // June — Jan 1-Jun 30 is "Vår" (spring).

export function computeHalfYearSeason(dateString: string): HalfYearSeason {
  const year = Number(dateString.slice(0, 4));
  const month = Number(dateString.slice(5, 7));

  if (month <= FIRST_HALF_LAST_MONTH) {
    return {
      label: `Vår ${year}`,
      startDate: `${year}-01-01`,
      endDate: `${year}-06-30`,
    };
  }
  return {
    label: `Höst ${year}`,
    startDate: `${year}-07-01`,
    endDate: `${year}-12-31`,
  };
}
